/** The host name of a source URL for a short link text ("vnf.fr"), or the text itself when it is not a URL. */
export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
