/**
 * 将 GitHub Release / electron-updater 等返回的带标签说明转为纯文本，避免界面出现 <p> 等原样字符。
 */
export function stripHtmlToPlain(html: string | null | undefined): string {
  if (html == null || String(html).trim() === '') return ''
  return String(html)
    .replace(/<\/(p|div|h[1-6]|li|tr)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}
