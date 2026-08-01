import api from './api';

/**
 * `api.get` for list endpoints, but returning **every** page instead of only the first.
 *
 * The API paginates at `PAGE_SIZE` (50), so reading `data.results` from a single request
 * silently truncates any longer list. Pages that total their columns from the fetched rows
 * then show *wrong numbers*, not merely fewer rows — which reads as an accounting error
 * rather than a fetch bug. Route list reads through here.
 *
 * The return value is deliberately shaped like an axios response whose `data` is the flat
 * array, so the usual `response.data.results || response.data` call sites keep working
 * unchanged: `results` is undefined on an array, so they fall through to the array itself.
 * `count` is preserved alongside for the few callers that read it.
 *
 * Paging is by page number, not by following the `next` URL: `next` is absolute and carries
 * the backend's own scheme/host, which does not survive a proxy or an http/https mismatch.
 * Existing query params on `url` are preserved. Pages after the first are fetched in
 * parallel. An endpoint with pagination disabled returns a plain array and is passed
 * straight through, so this is safe to use everywhere.
 *
 * @param {string} url  Path relative to the api baseURL; query string allowed.
 * @param {object} [config]  Extra axios config.
 * @returns {Promise<{ data: Array, count: number }>}
 */
export default async function apiGetAll(url, config = {}) {
  const first = await api.get(url, config);
  const body = first.data;

  if (Array.isArray(body)) return { data: body, count: body.length };
  if (!body || !Array.isArray(body.results)) return { data: [], count: 0 };

  const rows = [...body.results];
  const total = Number(body.count);

  if (!body.next || !Number.isFinite(total) || rows.length >= total) {
    return { data: rows, count: Number.isFinite(total) ? total : rows.length };
  }

  const pageSize = rows.length;
  if (pageSize <= 0) return { data: rows, count: total };

  const [path, query = ''] = url.split('?');
  const lastPage = Math.ceil(total / pageSize);

  const requests = [];
  for (let page = 2; page <= lastPage; page += 1) {
    const params = new URLSearchParams(query);
    params.set('page', String(page));
    requests.push(api.get(`${path}?${params.toString()}`, config));
  }

  const responses = await Promise.all(requests);
  for (const res of responses) {
    const chunk = res.data?.results;
    if (Array.isArray(chunk)) rows.push(...chunk);
  }
  return { data: rows, count: total };
}
