export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Some embedded browsers restrict the Clipboard API but support a selected text copy.
  }
  const focus = document.activeElement;
  const field = document.createElement('textarea');
  field.value = text;
  field.readOnly = true;
  field.style.cssText = 'position:fixed;left:-10000px;top:0';
  document.body.appendChild(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw new Error('当前浏览器无法复制，请手动选中文字');
  } finally {
    field.remove();
    if (focus instanceof HTMLElement) focus.focus();
  }
}
