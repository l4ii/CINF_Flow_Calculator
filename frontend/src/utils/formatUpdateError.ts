/**
 * 将 electron-updater / 主进程返回的更新相关英文与原始错误，转为与界面语言一致、面向非技术用户的短说明。
 * 不展示长堆栈或 API 细节，未知情况则返回通用提示。
 */
export function formatUpdateError(
  raw: string | null | undefined,
  lang: 'zh' | 'en'
): string {
  if (raw == null || String(raw).trim() === '') {
    return ''
  }
  const s = String(raw)
  const low = s.toLowerCase()

  if (s.includes('开发模式') && (s.includes('无法检查') || s.includes('无法下载') || s.includes('无法安装'))) {
    return lang === 'en'
      ? 'Auto-update is only available in the installed app, not in development mode.'
      : '自动更新仅适用于已安装版本；当前为开发/调试方式打开，无法使用。'
  }

  if (s.includes('当前环境不支持自动更新') || s.includes('浏览器环境下')) {
    return lang === 'en'
      ? 'Updates are not available in this view. Please use the installed desktop app.'
      : '当前无法使用自动更新，请通过已安装的本软件桌面版重试。'
  }

  if (s.includes('No published versions on GitHub') || low.includes('err_updater_no_published')) {
    return lang === 'en'
      ? "There isn't a published update package on the release page yet. Once your team adds a new version (with the installer) on GitHub, try «Check for updates» again."
      : '发布页上暂时还没有可安装的更新包。请等待维护人员在网站上发布带安装程序的新版本后，再点击「检查更新」。'
  }

  if (low.includes('err_updater_channel_file_not_found') || (s.includes('Cannot find') && s.includes('latest') && s.includes('yml'))) {
    return lang === 'en'
      ? "The new version's update description file is missing from the release. Please ask the team to publish the update again with all files, then retry."
      : '新版本发布中缺少更新说明文件。请让维护人员重新按规范上传完整发布文件后再试。'
  }

  if (low.includes('err_updater_invalid_release_feed') || s.includes('Cannot parse releases feed')) {
    return lang === 'en'
      ? "We couldn't read the update list from the server. The release data may be incomplete—please try again later or ask your app administrator."
      : '无法正确读取更新列表，可能是发布信息不完整。请稍后再试，或联系软件维护方。'
  }

  if (low.includes('err_updater_invalid_update_info')) {
    return lang === 'en'
      ? "The update information on the server looks invalid. Please try again later or contact support."
      : '服务器上的更新信息异常，请稍后再试或联系维护人员。'
  }

  if (
    low.includes('econnrefused') ||
    low.includes('etimedout') ||
    low.includes('enotfound') ||
    low.includes('econnreset') ||
    low.includes('network request failed') ||
    low.includes('getaddrinfo') ||
    low.includes('net::err_') ||
    low.includes('networkerror') ||
    s.includes('socket hang up') ||
    s.includes('fetch failed')
  ) {
    return lang === 'en'
      ? "We couldn't reach the update service. Check your internet connection, then try again. On restricted networks, contact your IT staff."
      : '无法连上更新服务。请检查网络后重试；若单位网络有限制，可联系信息化管理人员。'
  }

  if (
    low.includes(' 404') ||
    low.includes('statuscode":404') ||
    low.includes('statuscode: 404') ||
    low.includes('http error 404') ||
    s.includes('(404)')
  ) {
    if (s.includes('authentication') || s.includes('token') || s.includes('double check')) {
      return lang === 'en'
        ? "We couldn't read the update page—access may be restricted. If the project is not public, ask your team to use a public release location or a network-accessible update address."
        : '无法访问发布页，可能是项目未对公网开放或受权限限制。请与维护方确认发布方式。'
    }
    return lang === 'en'
      ? "The update information wasn't found (404). The new version may not be published yet, or the address may be out of date—ask your app team if this continues."
      : '未找到更新信息（可能尚未发布新版本，或发布地址有变化）。若多次出现，请向软件维护方确认。'
  }

  if (low.includes(' 403') || low.includes(' 401') || s.includes('forbidden')) {
    return lang === 'en'
      ? "Access to the update was blocked. Your network or account may not allow it—try another network or ask IT support."
      : '没有权限拉取本更新。可尝试其它网络，或联系单位信息化/软件维护方。'
  }

  if (s.includes('GitHub') && s.includes("couldn't find")) {
    return lang === 'en'
      ? "We couldn't find the update on the release service. It may not be published yet; try again after your team posts a new release."
      : '在发布服务上未找到可用更新。可能尚未完成发布，请待维护方发布新版本后再试。'
  }

  // 其它：不展示长英文堆栈
  return lang === 'en'
    ? "We couldn't complete the update check. Please try again in a few minutes. If it keeps happening, contact your app administrator or support."
    : '暂时无法完成检查。请过几分钟重试。若一直失败，请联系本单位软件或信息化支持人员。'
}
