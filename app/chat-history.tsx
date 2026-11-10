'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, Languages, RefreshCw, X } from 'lucide-react';
import { copyText } from '../lib/clipboard';

type Message = { sender?: string; time?: string; text?: string };
type Session = { buyer: string; shop: string; owner: string; count: number; sourceRef: string };
type Monitor = (target: EventTarget) => void;
type Detector = {
  detect(text: string): Promise<{ detectedLanguage: string; confidence: number }[]>;
  destroy(): void;
};
type Translator = { translate(text: string): Promise<string>; destroy(): void };
type TranslationWindow = Window & {
  LanguageDetector?: { create(options: { signal: AbortSignal }): Promise<Detector> };
  Translator?: {
    create(options: {
      sourceLanguage: string; targetLanguage: string; signal: AbortSignal; monitor: Monitor;
    }): Promise<Translator>;
  };
};

function canTranslate(text: string) {
  return /\p{L}/u.test(text)
    && !/^https?:\/\/\S+$/i.test(text)
    && !/^(?:\[|【|（|\()?(?:图片|语音|视频|文件|表情|附件|原表未提供文字内容)(?:\]|】|）|\))?$/.test(text);
}

function languageCode(language: string) {
  if (/^zh-(?:hant|tw|hk|mo)(?:-|$)/i.test(language)) return 'zh-Hant';
  return language.split('-')[0].toLowerCase();
}

function speaker(sender?: string) {
  if (!sender || /^(未知|unknown)$/i.test(sender)) return '方向未标注';
  if (sender === 'buyer') return '买家';
  if (sender === 'seller') return '卖家';
  return sender;
}

export default function ChatHistory({
  session, rows, loading, close, label = '历史会话', notice,
}: {
  session: Session; rows: Message[]; loading: boolean; close: () => void;
  label?: string; notice?: React.ReactNode;
}) {
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [showChinese, setShowChinese] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [retry, setRetry] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function translate() {
    if (active.current) return;
    const { Translator: api, LanguageDetector } = window as TranslationWindow;
    if (!api || !LanguageDetector) {
      setStatus('当前浏览器无法使用本机翻译，请在桌面版 Chrome 打开此会话。');
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    setRunning(true);
    setShowChinese(true);
    setStatus('正在识别消息语言…');
    let detector: Detector | undefined;
    const engines = new Map<string, Translator>();
    try {
      const candidates = rows.flatMap((row, index) => {
        const text = row.text?.trim() ?? '';
        return canTranslate(text) ? [{ index, text }] : [];
      });
      detector = await LanguageDetector.create({ signal: controller.signal });
      const context = candidates.map(row => row.text).join('\n').slice(0, 2600);
      const [guess] = context ? await detector.detect(context) : [];
      const defaultLanguage = guess && guess.confidence >= 0.45 ? languageCode(guess.detectedLanguage) : 'en';
      const groups = new Map<string, typeof candidates>();
      for (const row of candidates) {
        const [match] = await detector.detect(row.text.slice(0, 2000));
        const detected = match && match.confidence >= 0.55 ? languageCode(match.detectedLanguage) : defaultLanguage;
        const language = detected === 'und' ? defaultLanguage : detected;
        if (language === 'zh') continue;
        const group = groups.get(language) ?? [];
        group.push(row);
        groups.set(language, group);
      }
      const total = [...groups.values()].reduce((sum, group) => sum + group.length, 0);
      if (!total) {
        setStatus('这段会话没有需要翻译的文字。');
        setRetry(false);
        return;
      }
      await Promise.all([...groups.keys()].map(async language => {
        try {
          const engine = await api.create({
            sourceLanguage: language, targetLanguage: 'zh', signal: controller.signal,
            monitor: target => target.addEventListener('downloadprogress', event => {
              const progress = Math.round(((event as ProgressEvent).loaded || 0) * 100);
              if (!controller.signal.aborted) setStatus(`正在准备翻译语言包 ${progress}%…`);
            }),
          });
          engines.set(language, engine);
        } catch {
          // Unsupported or unavailable language packs leave those messages readable as originals.
        }
      }));

      let count = 0;
      const result: Record<number, string> = {};
      for (const [language, group] of groups) {
        const engine = engines.get(language);
        if (!engine) continue;
        for (const row of group) {
          if (controller.signal.aborted) return;
          try {
            const translated = (await engine.translate(row.text)).trim();
            if (!translated) continue;
            result[row.index] = translated;
            count++;
            if (controller.signal.aborted) return;
            setTranslations(previous => ({ ...previous, [row.index]: translated }));
            setStatus(`正在翻译 ${count} / ${total} 条…`);
          } catch {
            // Keep the source message for any individual failure.
          }
        }
      }
      if (controller.signal.aborted) return;
      setTranslations(result);
      setRetry(count < total);
      setStatus(count === total
        ? `已翻译 ${count} 条消息，可切回原文核对。`
        : `已翻译 ${count} 条，还有 ${total - count} 条保留原文。可重试翻译。`);
    } catch {
      if (!controller.signal.aborted) {
        setStatus('浏览器暂时无法准备翻译，请稍后重试。');
        setRetry(true);
      }
    } finally {
      detector?.destroy();
      engines.forEach(engine => engine.destroy());
      active.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  const translated = Object.keys(translations).length > 0;
  const buttonLabel = running ? '正在翻译' : translated ? (showChinese ? '显示原文' : '显示中文') : '翻译成中文';
  const visibleMessage = (row: Message, index: number) =>
    (showChinese ? translations[index] : undefined) || row.text || '（原表未提供文字内容）';
  async function copy(message: string, feedback: string) {
    try { await copyText(message); setCopyFeedback(feedback); }
    catch (error) { setCopyFeedback((error as Error).message); }
  }
  function copyConversation() {
    const transcript = rows.map((row, index) =>
      `${speaker(row.sender)} · ${row.time || '—'}\n${visibleMessage(row, index)}`,
    ).join('\n\n');
    return copy(`${session.buyer} · ${session.shop}\n\n${transcript}`, '已复制整段对话');
  }
  return <div className="overlay chat-overlay" onClick={close}>
    <div className="chat-modal" role="dialog" aria-modal="true" aria-label={label} onClick={event => event.stopPropagation()}>
      <div className="drawer-top">
        <div><strong>{session.buyer}</strong><small>{session.shop} · {session.owner} · {session.count} 条原始消息</small></div>
        <div className="chat-header-actions">
          <button className="btn" type="button" disabled={loading || running || !rows.length} onClick={() => void copyConversation()}>
            <Copy size={15}/>复制对话
          </button>
          <button className="btn" type="button" disabled={loading || running || !rows.length}
            onClick={() => translated ? setShowChinese(!showChinese) : void translate()}>
            {running ? <RefreshCw className="spin" size={15}/> : <Languages size={15}/>}
            {buttonLabel}
          </button>
          <button className="icon-btn" type="button" onClick={close} aria-label={'关闭' + label}><X size={21}/></button>
        </div>
      </div>
      <div className="chat-notice">{notice ?? '历史会话只读 · 发送方未明确的消息保留“方向未标注” · 图片、语音等仅显示原始导出内容'}</div>
      {copyFeedback && <div className="chat-translation-status" role="status">{copyFeedback}</div>}
      {status && <div className="chat-translation-status" role="status">
        <span>{status}</span>
        {retry && !running && translated && <button className="text-btn" onClick={() => void translate()}>重试翻译</button>}
      </div>}
      <div className="chat-scroll">
        {loading ? <div className="loading"><RefreshCw className="spin"/>正在读取消息</div> : rows.map((message, index) => {
          const translation = showChinese ? translations[index] : undefined;
          return <div className={/卖家|seller/i.test(message.sender ?? '') ? 'message seller' : 'message'} key={index}>
            <div className="message-meta">{speaker(message.sender)} · {message.time || '—'}{translation ? ' · 中文译文' : ''}
              {message.text && <button className="chat-copy-message" type="button" aria-label={`复制第 ${index + 1} 条消息`}
                onClick={() => void copy(visibleMessage(message, index), `已复制第 ${index + 1} 条消息`)}><Copy size={12}/>复制</button>}
            </div>
            <div className="message-bubble">{visibleMessage(message, index)}</div>
          </div>;
        })}
      </div>
      <div className="chat-source">来源：{session.sourceRef}</div>
    </div>
  </div>;
}
