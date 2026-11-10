#!/usr/bin/env python3
"""Run a temporary, local-only read test for one Tencent enterprise mailbox."""

import base64
from argparse import ArgumentParser
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import imaplib
import json
from pathlib import Path
import re
import secrets
import ssl
import threading
from urllib.parse import parse_qs


ARCHIVE_ACCOUNT = json.loads((Path(__file__).resolve().parents[1] / "lib/crm-config.json").read_text(encoding="utf-8"))["mailbox"].strip().casefold()
HOST = "imap.exmail.qq.com"
PORT = 993
MAILBOX_ROW = re.compile(rb'^\(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.*)$')
SENT_NAMES = {"sent", "sent items", "sent messages", "sent mail", "已发送", "已发送邮件", "发件箱"}


def decoded_mailbox(name):
    def decode(match):
        encoded = match[1].replace(b",", b"/")
        if not encoded:
            return b"&"
        utf16 = base64.b64decode(encoded + b"=" * (-len(encoded) % 4))
        return utf16.decode("utf-16-be").encode("utf-8")

    return re.sub(rb"&([A-Za-z0-9+,]*)-", decode, name).decode("utf-8")


def mailbox_entries(entries):
    for row in entries:
        match = MAILBOX_ROW.fullmatch(row[0] if isinstance(row, tuple) else row or b"")
        if not match:
            continue
        flags = match[1].lower().split()
        if b"\\noselect" in flags:
            continue
        if isinstance(row, tuple):
            name = row[1]
        elif match[2].startswith(b'"'):
            name = re.sub(rb"\\(.)", rb"\1", match[2][1:-1])
        else:
            name = match[2]
        try:
            yield name, decoded_mailbox(name), flags
        except ValueError:
            continue


def sent_mailbox(entries):
    by_name = None
    for name, label, flags in mailbox_entries(entries):
        if b"\\sent" in flags:
            return name
        if label.casefold() in SENT_NAMES:
            by_name = name
    return by_name


def check_folder(client, name):
    if not name:
        return "未在邮箱服务器找到这个文件夹。"
    quoted = b'"' + name.replace(b"\\", b"\\\\").replace(b'"', b'\\"') + b'"'
    status, data = client.select(quoted, readonly=True)
    if status != "OK" or not data or not (data[0] or b"").isdigit():
        return "无法以只读方式打开。"
    count = int(data[0])
    if not count:
        return "只读打开成功，文件夹内没有邮件。"
    status, sample = client.fetch(str(count), "(BODY.PEEK[TEXT]<0.64>)")
    if status == "OK" and any(isinstance(part, tuple) for part in sample):
        return f"只读打开成功，共 {count:,} 封，已验证可读邮件内容。"
    return f"只读打开成功，共 {count:,} 封，邮件内容读取未通过。"


def test_mailbox(address, password):
    try:
        with imaplib.IMAP4_SSL(HOST, PORT, ssl_context=ssl.create_default_context(), timeout=8) as client:
            try:
                client.login(f'"{address}"', password)
            except imaplib.IMAP4.abort:
                raise
            except imaplib.IMAP4.error:
                return "腾讯邮箱登录未通过。请核对完整邮箱地址、客户端专用密码和 IMAP 开关。", []
            inbox = check_folder(client, b"INBOX")
            status, folders = client.list()
            sent = check_folder(client, sent_mailbox(folders)) if status == "OK" else "无法获取文件夹列表。"
            return "腾讯邮箱登录成功", [("收件箱", inbox), ("已发送", sent)]
    except (OSError, imaplib.IMAP4.error):
        return "腾讯邮箱连接中断或超时。请稍后再试。", []


def page(title="腾讯企业邮箱连接测试", results=(), archive=False, reading=False):
    rows = "".join(f"<li><strong>{escape(name)}</strong>　{escape(result)}</li>" for name, result in results)
    archive_account = f'value="{escape(ARCHIVE_ACCOUNT)}" readonly' if archive else ""
    form = f"""<form method="post" autocomplete="off">
<label>完整企业邮箱<input name="address" type="email" maxlength="254" placeholder="你的企业邮箱地址" required {archive_account}></label>
<label>客户端专用密码<input name="password" type="password" maxlength="128" autocomplete="new-password" required></label>
<button type="submit">{'开始读取 Export 邮件' if archive else '开始只读测试'}</button></form>"""
    return f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8">
{'<meta http-equiv="refresh" content="4">' if reading else ''}
<meta name="viewport" content="width=device-width,initial-scale=1"><title>腾讯企业邮箱连接测试</title>
<style>
* {{ box-sizing: border-box }} body {{ margin:0; background:#f3f6f6; color:#18353b; font:16px/1.6 system-ui,sans-serif }}
main {{ max-width:610px; margin:10vh auto 1rem; background:white; border:1px solid #d9e4e4; border-radius:16px; padding:clamp(20px,5vw,38px) }}
h1 {{ margin:0; font-size:1.55rem }} p {{ color:#4d6268 }} label {{ display:block; font-weight:650; margin-top:16px }}
input {{ display:block; width:100%; border:1px solid #a6bcbe; border-radius:8px; margin-top:5px; padding:10px; font:inherit }}
button {{ margin-top:20px; border:0; border-radius:8px; padding:10px 20px; background:#0f746a; color:white; font:inherit; font-weight:650; cursor:pointer }}
</style><main><h1>{escape(title)}</h1>{f'<ul>{rows}</ul>' if rows else ''}
<p>{'在本机读取 Export 邮箱。专用密码仅用于这一次连接。' if archive else '在本机测试收件箱和已发送。页面只显示读取结果，专用密码仅用于这一次连接。'}</p>
{ '<p>页面会自动更新读取进度。</p>' if reading else form }</main></html>"""


def main():
    parser = ArgumentParser()
    parser.add_argument('--archive', help='Write a private Export mailbox bundle to this path')
    parser.add_argument('--port', type=int, default=0, help='Loopback port for a resumed session')
    parser.add_argument('--link-token', help='Reuse a previously issued local link token')
    options = parser.parse_args()
    if options.link_token and not re.fullmatch(r'[A-Za-z0-9_-]{32,64}', options.link_token):
        parser.error('Invalid link token')
    run_lock = threading.Lock()
    path = "/" + (options.link_token or secrets.token_urlsafe(24))
    status = ('Export 邮件读取' if options.archive else '腾讯企业邮箱连接测试', (), False)

    def read_archive(address, password):
        nonlocal status

        def report(scanned, reconnecting=False):
            nonlocal status
            title = '连接中断，正在自动续读' if reconnecting else '正在读取 Export 邮件'
            status = (title, [('已检查邮件', str(scanned))], True)

        try:
            from tencent_mail_archive import export_mailbox
            result = export_mailbox(address, password, options.archive, mailbox_entries, sent_mailbox, report)
            status = ('邮件导入包已准备好', result, False)
        except PermissionError:
            status = ('Export 登录未通过，请核对客户端专用密码和 IMAP 设置', (), False)
        except (OSError, imaplib.IMAP4.error) as error:
            status = ('暂时未能续读，已读取记录保留', [('异常类型', type(error).__name__)], False)
        except Exception as error:
            status = ('本机读取暂停，已读取记录保留', [('异常类型', type(error).__name__)], False)
        finally:
            run_lock.release()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def valid_target(self):
            return self.path == path and self.headers.get("Host") == server_address

        def show(self, *args, reading=False):
            body = page(*args, archive=bool(options.archive), reading=reading).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            # Keep the browser's Origin header on same-origin form submissions.
            self.send_header("Referrer-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if not self.valid_target():
                self.send_error(404)
                return
            title, results, reading = status
            self.show(title, results, reading=reading)

        def do_POST(self):
            if not self.valid_target() or self.headers.get("Origin") != origin:
                self.send_error(403)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096 or self.headers.get_content_type() != "application/x-www-form-urlencoded":
                    raise ValueError
                form = parse_qs(self.rfile.read(size).decode("ascii"), max_num_fields=2)
                address = form["address"][0].strip()
                password = form["password"][0]
                if (len(address) > 254 or not re.fullmatch(r"[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", address)
                        or not re.fullmatch(r"[ -~]{1,128}", password)):
                    raise ValueError
            except (KeyError, ValueError):
                self.show("请填写完整邮箱地址和客户端专用密码")
                return
            if not options.archive:
                self.show(*test_mailbox(address, password))
                return
            if address.casefold() != ARCHIVE_ACCOUNT:
                self.show('请使用已配置企业邮箱的专用密码')
                return
            if not run_lock.acquire(blocking=False):
                self.show('正在读取，请等待当前操作完成')
                return
            nonlocal status
            status = ('正在连接 Export 邮箱', (), True)
            threading.Thread(target=read_archive, args=(address.lower(), password), daemon=True).start()
            self.send_response(303)
            self.send_header('Location', path)
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()

    with ThreadingHTTPServer(("127.0.0.1", options.port), Handler) as server:
        server_address = f"127.0.0.1:{server.server_port}"
        origin = "http://" + server_address
        print(origin + path, flush=True)
        expiry = threading.Timer((90 if options.archive else 30) * 60, server.shutdown)
        expiry.daemon = True
        expiry.start()
        try:
            server.serve_forever()
        finally:
            expiry.cancel()


if __name__ == "__main__":
    main()
