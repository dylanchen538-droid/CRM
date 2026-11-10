"""Export customer correspondence from the authorized Export mailbox without changing it."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.errors import MessageError
from email.utils import getaddresses, parsedate_to_datetime
from hashlib import sha256
from html.parser import HTMLParser
import imaplib
import json
import os
from pathlib import Path
import re
import sqlite3
import ssl
import tempfile
from threading import Lock
import time


MAILBOX_DOMAIN = json.loads((Path(__file__).resolve().parents[1] / 'lib/crm-config.json').read_text(encoding='utf-8'))['mailbox'].strip().casefold().rsplit('@', 1)[1]

SKIP_FLAGS = {b'\\trash', b'\\junk', b'\\drafts', b'\\all'}
SKIP_NAMES = {'junk', 'junk e-mail', 'spam', 'trash', 'deleted messages', 'deleted items',
              'drafts', 'outbox', 'all mail', '垃圾邮件', '已删除', '草稿箱', '待发邮件'}
PARSER = BytesParser(policy=policy.default)
ADDRESS = re.compile(r'[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+')
BODY_LIMIT = 18000
RAW_LIMIT = 1024 * 1024
BODY_SAMPLE = 16 * 1024
BODY_EXPANDED = 128 * 1024
BODY_BATCH_BYTES = 16 * BODY_SAMPLE
PARSE_ERRORS = (MessageError, ValueError, TypeError, IndexError, LookupError, OverflowError, AttributeError, RecursionError)


def raw_fields(message, field):
    return [value for key, value in message.raw_items() if key.casefold() == field.casefold()]


def field_text(message, field, default=''):
    try:
        return str(message.get(field, default))
    except PARSE_ERRORS:
        return next(iter(raw_fields(message, field)), default)


class TextHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {'style', 'script', 'head'}:
            self.hidden += 1
        if not self.hidden and tag in {'p', 'br', 'div', 'li', 'tr'}:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in {'style', 'script', 'head'} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def addresses(message, field):
    try:
        pairs = [(a.display_name or '', a.addr_spec) for header in message.get_all(field, [])
                 for a in getattr(header, 'addresses', ())]
    except PARSE_ERRORS:
        try:
            pairs = getaddresses(raw_fields(message, field))
        except PARSE_ERRORS:
            pairs = []
    return {value.casefold(): name.strip()[:160] for name, value in pairs
            if ADDRESS.fullmatch(value) and not value.casefold().endswith('@' + MAILBOX_DOMAIN)}


def correspondence(message, direction):
    if (field_text(message, 'Auto-Submitted', 'no').strip().lower() != 'no' or field_text(message, 'List-Id')
            or field_text(message, 'Precedence').strip().lower() in {'bulk', 'list', 'junk'}):
        return None
    senders = addresses(message, 'From')
    if direction == 'custom':
        direction = 'received' if senders else 'sent'
    parties = senders if direction == 'received' else addresses(message, 'To')
    if direction == 'sent' and not parties:
        parties = {**addresses(message, 'Cc'), **addresses(message, 'Bcc')}
    if not parties or all(re.match(r'^(?:no-?reply|mailer-daemon|postmaster|do-?not-?reply)@', a) for a in parties):
        return None
    return direction, parties


def part_complete(message, part, raw):
    # A MIME boundary after the chosen text means the rest of the bytes can
    # belong to an attachment without truncating the visible message.
    for parent in message.walk():
        boundary = parent.get_boundary()
        if not boundary:
            continue
        for index, child in enumerate(parent.iter_parts()):
            if child is part:
                marker = re.escape(boundary.encode('ascii', errors='replace'))
                return len(re.findall(rb'(?m)^--' + marker + rb'(?:--)?[ \t]*\r?$', raw)) >= index + 2
    return False


def message_text(raw, incomplete=False):
    message = PARSER.parsebytes(raw)
    part = message.get_body(preferencelist=('plain', 'html'))
    if part is None:
        return '', False
    data = part.get_payload(decode=True) or b''
    try:
        value = data.decode(part.get_content_charset() or 'utf-8', errors='replace')
    except LookupError:
        value = data.decode('utf-8', errors='replace')
    if part.get_content_type() == 'text/html':
        parser = TextHTML()
        parser.feed(value)
        value = ''.join(parser.parts)
    value = re.sub(r'\n{4,}', '\n\n\n', value.replace('\r\n', '\n')).strip()
    return value[:BODY_LIMIT], len(value) > BODY_LIMIT or (incomplete and not part_complete(message, part, raw))


def timestamp(message, metadata):
    try:
        value = getattr(message.get('Date'), 'datetime', None)
    except PARSE_ERRORS:
        value = None
    if value is None:
        match = re.search(rb'INTERNALDATE "([^"]+)"', metadata)
        try:
            value = parsedate_to_datetime(match[1].decode('ascii')) if match else None
        except (ValueError, TypeError):
            value = None
    if not value:
        return ''
    try:
        if not value.tzinfo:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError):
        return ''


def fetch_rows(client, keys, fields):
    status, data = client.uid('FETCH', ','.join(keys), fields)
    if status != 'OK':
        raise imaplib.IMAP4.error('Cannot fetch selected messages')
    for index, item in enumerate(data or []):
        if isinstance(item, tuple):
            trailer = data[index+1] if index+1 < len(data) and isinstance(data[index+1], bytes) else b''
            metadata = item[0] + b' ' + trailer
            uid = re.search(rb'\bUID (\d+)', metadata)
            if uid:
                yield uid[1].decode('ascii'), metadata, item[1]


def message_sizes(metadata):
    size = re.search(rb'\bRFC822.SIZE (\d+)', metadata)
    return int(size[1]) if size else RAW_LIMIT


def body_batches(rows):
    batch, total = [], 0
    for uid, metadata, *_ in rows:
        size = min(message_sizes(metadata), BODY_SAMPLE)
        if batch and (total + size > BODY_BATCH_BYTES or len(batch) == 16):
            yield batch
            batch, total = [], 0
        batch.append(uid)
        total += size
    if batch:
        yield batch


def quoted_folder(folder):
    return b'"' + folder.replace(b'\\', b'\\\\').replace(b'"', b'\\"') + b'"'


def archive_folder(client, folder, label, direction, account, checkpoint, scanned, progress, partition=(0, 1)):
    status, info = client.select(quoted_folder(folder), readonly=True)
    if status == 'NO' and direction == 'custom':
        return False
    if status != 'OK':
        raise imaplib.IMAP4.error('Cannot open folder')
    epoch = (client.response('UIDVALIDITY')[1] or [b'0'])[0] or b'0'
    with checkpoint:
        checkpoint.execute('DELETE FROM messages WHERE folder=? AND epoch<>?', (folder, epoch))
    if info == [b'0']:
        return True
    status, matches = client.uid('SEARCH', None, 'ALL')
    if status != 'OK':
        raise imaplib.IMAP4.error('Cannot list messages')
    saved = {row[0] for row in checkpoint.execute('SELECT uid FROM messages WHERE folder=? AND epoch=?', (folder, epoch))}
    uids = [uid for uid in (matches[0] or b'').decode('ascii').split()
            if uid not in saved and int(uid) % partition[1] == partition[0]]
    for offset in range(0, len(uids), 25):
        chunk = uids[offset:offset + 25]
        headers = fetch_rows(client, chunk, '(UID INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM TO CC BCC SUBJECT DATE MESSAGE-ID AUTO-SUBMITTED LIST-ID PRECEDENCE)])')
        fetched, candidates = set(), []
        for uid, meta, raw_header in headers:
            if uid not in chunk or uid in fetched:
                continue
            fetched.add(uid)
            outcome = 'skipped'
            try:
                header = PARSER.parsebytes(raw_header)
                parties = correspondence(header, direction)
            except PARSE_ERRORS:
                parties = None
                outcome = 'unreadable'
            if parties:
                candidates.append((uid, meta, header, parties))
            else:
                with checkpoint:
                    checkpoint.execute('INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?, NULL)',
                                       (folder, epoch, uid, outcome))
                scanned[0] += 1
        if fetched != set(chunk):
            raise imaplib.IMAP4.error('Message list changed during export')
        remaining = {item[0]: item[1:] for item in candidates}
        for keys in body_batches(candidates):
            fields = f'(UID BODY.PEEK[]<0.{BODY_SAMPLE}>)'
            samples = {uid: raw for uid, _, raw in fetch_rows(client, keys, fields)}
            for uid in keys:
                meta, header, parties = remaining.pop(uid)
                flow, contacts = parties
                message_id = field_text(header, 'Message-ID').strip()
                identity = f'{account}\n{message_id}' if message_id else f'{account}\n{folder!r}\n{epoch!r}\n{uid}'
                key = sha256(identity.encode('utf-8', errors='replace')).hexdigest()
                raw = samples.get(uid)
                if raw is None and len(keys) > 1:
                    raw = next((raw for key, _, raw in fetch_rows(client, [uid], fields) if key == uid), None)
                size = message_sizes(meta)
                try:
                    body, truncated = message_text(raw, size > len(raw)) if raw is not None else ('', False)
                    for limit in (BODY_EXPANDED, RAW_LIMIT):
                        if raw is None or size <= len(raw) or (body and (not truncated or len(body) >= BODY_LIMIT)):
                            break
                        expanded = next((sample for key, _, sample in fetch_rows(
                            client, [uid], f'(UID BODY.PEEK[]<0.{limit}>)') if key == uid), None)
                        if expanded is None or len(expanded) <= len(raw):
                            break
                        raw = expanded
                        body, truncated = message_text(raw, size > len(raw))
                except PARSE_ERRORS:
                    body, truncated = '', True
                outcome = 'mail' if body else 'noBody'
                row = {'id': key, 'direction': flow, 'contacts': [{'email': k, 'name': v} for k, v in contacts.items()][:25],
                       'at': timestamp(header, meta), 'folder': label[:240], 'uid': uid,
                       'subject': field_text(header, 'Subject')[:500], 'body': body,
                       'truncated': truncated, 'messageId': message_id[:500]}
                with checkpoint:
                    checkpoint.execute('INSERT OR IGNORE INTO messages VALUES (?, ?, ?, ?, ?)',
                                       (folder, epoch, uid, outcome, json.dumps(row)))
                scanned[0] += 1
        progress(scanned[0])
    return True


@contextmanager
def signed_in(account, password):
    with imaplib.IMAP4_SSL('imap.exmail.qq.com', 993, ssl_context=ssl.create_default_context(), timeout=30) as client:
        try:
            client.login(f'"{account}"', password)
        except imaplib.IMAP4.abort:
            raise
        except imaplib.IMAP4.error as error:
            raise PermissionError('Mailbox authentication failed') from error
        yield client


def archive_sent(client, folder, label, direction, account, password, checkpoint, scanned, progress):
    saved = checkpoint.execute('SELECT count(*) FROM messages WHERE folder=?', (folder,)).fetchone()[0]
    if saved:
        status, values = client.status(quoted_folder(folder), '(MESSAGES)')
        total = re.search(rb'\bMESSAGES (\d+)', values[0] or b'') if status == 'OK' and values else None
        if total and int(total[1]) - saved <= 25:
            return archive_folder(client, folder, label, direction, account, checkpoint, scanned, progress)
    # Divide by the stable UID, independent of which messages are already saved.
    # Each connection is read-only and owns its SQLite connection.
    path = checkpoint.execute('PRAGMA database_list').fetchone()[2]
    lock = Lock()

    def partitioned(index, connection):
        latest = 0

        def report(done):
            nonlocal latest
            with lock:
                scanned[0] += done - latest
                latest = done
                progress(scanned[0])

        with closing(sqlite3.connect(path, timeout=30)) as db:
            return archive_folder(connection, folder, label, direction, account, db, [0], report, (index, 3))

    def extra(index):
        with signed_in(account, password) as connection:
            return partitioned(index, connection)

    with ThreadPoolExecutor(max_workers=2) as pool:
        workers = [pool.submit(extra, index) for index in (1, 2)]
        partitioned(0, client)
        for worker in workers:
            try:
                worker.result()
            except (PermissionError, OSError, imaplib.IMAP4.error):
                pass  # The final serial check fills in this connection's gaps.
    scanned[0] = checkpoint.execute('SELECT count(*) FROM messages').fetchone()[0]
    return archive_folder(client, folder, label, direction, account, checkpoint, scanned, progress)


def archive_customs(client, folders, account, password, checkpoint, scanned, progress):
    if not folders:
        return 0, 0
    path = checkpoint.execute('PRAGMA database_list').fetchone()[2]
    lock = Lock()

    def run(connection, group):
        done, checked = [0], 0
        latest = 0

        def report(now):
            nonlocal latest
            with lock:
                scanned[0] += now - latest
                latest = now
                progress(scanned[0])

        with closing(sqlite3.connect(path, timeout=30)) as db:
            for folder, label in group:
                checked += archive_folder(connection, folder, label, 'custom', account, db, done, report)
                report(done[0])
        return checked, len(group) - checked

    def extra(group):
        with signed_in(account, password) as connection:
            return run(connection, group)

    groups = [folders[i::3] for i in range(3)]
    missing = []
    with ThreadPoolExecutor(max_workers=2) as pool:
        workers = [(group, pool.submit(extra, group)) for group in groups[1:] if group]
        checked, unavailable = run(client, groups[0])
        for group, worker in workers:
            try:
                n, absent = worker.result()
                checked += n
                unavailable += absent
            except (PermissionError, OSError, imaplib.IMAP4.error):
                missing.extend(group)
    if missing:
        n, absent = run(client, missing)
        checked += n
        unavailable += absent
    scanned[0] = checkpoint.execute('SELECT count(*) FROM messages').fetchone()[0]
    return checked, unavailable


def scan_mailbox(account, password, mailbox_entries, sent_mailbox, checkpoint, scanned, progress):
    with signed_in(account, password) as client:
        progress(scanned[0])
        status, entries = client.list()
        sent = sent_mailbox(entries or [])
        if status != 'OK' or sent is None:
            raise imaplib.IMAP4.error('Sent folder is unavailable')
        archive_folder(client, b'INBOX', '收件箱', 'received', account, checkpoint, scanned, progress)
        archive_sent(client, sent, '已发送', 'sent', account, password, checkpoint, scanned, progress)
        folders = [(name, label) for name, label, flags in mailbox_entries(entries or [])
                   if name.upper() != b'INBOX' and name != sent and not SKIP_FLAGS.intersection(flags)
                   and label.casefold() not in SKIP_NAMES]
        checked, unavailable = archive_customs(client, folders, account, password, checkpoint, scanned, progress)
        return checked + 2, unavailable


def write_archive(checkpoint, destination, account, folders, unavailable):
    counts = {'scanned': 0, 'duplicates': 0, 'skipped': 0, 'noBody': 0,
              'unreadable': 0, 'unavailableFolders': unavailable}
    seen = set()
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=destination.parent, delete=False) as output:
        staged = Path(output.name)
        try:
            output.write('{"format":"meliastage-mail-v1","account":'+json.dumps(account)+',"messages":[')
            for outcome, data in checkpoint.execute("SELECT outcome, data FROM messages ORDER BY outcome='noBody', rowid"):
                counts['scanned'] += 1
                if data is None:
                    counts[outcome] += 1
                    continue
                row = json.loads(data)
                if row['id'] in seen:
                    counts['duplicates'] += 1
                    continue
                if seen:
                    output.write(',')
                output.write(data)
                seen.add(row['id'])
                counts['noBody'] += outcome == 'noBody'
            output.write('],"counts":'+json.dumps(counts)+'}')
            output.close()
            os.replace(staged, destination)
        finally:
            staged.unlink(missing_ok=True)
    return [('已检查文件夹', str(folders)), ('读取邮件', str(counts['scanned'])),
            ('可导入客户往来', str(len(seen))), ('重复副本', str(counts['duplicates'])),
            ('无客户对应或自动邮件', str(counts['skipped'])), ('只有信头的记录', str(counts['noBody'])),
            ('未能识别的邮件', str(counts['unreadable'])), ('不可访问的自建文件夹', str(unavailable))]


def export_mailbox(account, password, target, mailbox_entries, sent_mailbox, progress=lambda scanned, reconnecting=False: None):
    destination = Path(target)
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    checkpoint_path = destination.with_suffix('.checkpoint.sqlite')
    fd = os.open(checkpoint_path, os.O_WRONLY | os.O_CREAT, 0o600)
    os.close(fd)
    with closing(sqlite3.connect(checkpoint_path)) as checkpoint:
        checkpoint.execute('CREATE TABLE IF NOT EXISTS messages (folder BLOB, epoch BLOB, uid TEXT, outcome TEXT, data TEXT, PRIMARY KEY(folder, epoch, uid))')
        scanned = [checkpoint.execute('SELECT count(*) FROM messages').fetchone()[0]]
        attempts = 0
        while True:
            start = scanned[0]
            try:
                folders, unavailable = scan_mailbox(account, password, mailbox_entries, sent_mailbox, checkpoint, scanned, progress)
                break
            except (PermissionError, ssl.SSLCertVerificationError):
                raise
            except (OSError, imaplib.IMAP4.error):
                scanned[0] = checkpoint.execute('SELECT count(*) FROM messages').fetchone()[0]
                attempts = 1 if scanned[0] > start else attempts + 1
                if attempts >= 6:
                    raise
                progress(scanned[0], True)
                time.sleep(min(2 ** attempts, 15))
        return write_archive(checkpoint, destination, account, folders, unavailable)
