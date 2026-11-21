# Interway route service: security and cost limits on Cloudflare

Researched 2026-11-21 against developers.cloudflare.com and other official pages. Every fact is tagged:

- **[V]** verified on the official page named next to it (page `dateModified` in brackets where shown).
- **[C]** checked in the installed code: `@cloudflare/containers` 0.3.7, `wrangler` 4.166.0, `@cloudflare/workers-types` 5.20261121.1.
- **[I]** my inference or estimate, not stated by Cloudflare.

The draft `worker.ts` and `wrangler.jsonc` in section 5 were type-checked with `tsc`. They passed `wrangler deploy --dry-run`, and a smoke test under `wrangler dev` with a stub container checked URL normalisation, 404, 413 and 429 handling and MCP passthrough. Copies are in `/tmp/claude-0/-home-user-interway/89954242-6d28-54da-9f54-5a6aad91facb/scratchpad/check/`. No repo files were changed.

---

## Summary

| Area | Finding |
|---|---|
| Normal cost | **$6–15/month** at 1k–1M route requests. The container's memory while it is awake is most of the bill above the $5 plan. |
| Flood cost | A **one-day** flood at 100 req/s costs about **$0.30–2.20** extra. A **month-long** flood costs about **$105–145**, mostly Worker and Durable Object request charges. |
| Hard caps | Cloudflare now has **spending limits for Workers and for Durable Objects** (not Containers), plus **budget alerts**. Set all of them. |
| Biggest code risks today | 1. No limit on request body size. 2. JSON-RPC batches are accepted, so one POST can run many routes. 3. The number of `via` stops is unlimited. 4. Geocoder calls have no timeout or cache. 5. Error text leaks to callers. 6. A cold start (about 20 s of data loading) races the library's 20 s port timeout. |
| Cache | Use **Workers Cache** (new, works on workers.dev). Cached hits never run the Worker or wake the container. |

---

## 1. Cost model (Workers Paid, November 2026)

### 1.1 Rates

**Workers** [V workers/platform/pricing, 2026-11-18]

- $5/month minimum per account.
- Requests: 10M included, then $0.30 per million.
- CPU: 30M CPU-ms included, then $0.02 per million ms.

**Durable Objects** (each container has one) [V same page]

- Requests: 1M included, then $0.15 per million.
- Duration: 400,000 GB-s included, then $12.50 per million GB-s. Duration is charged on 128 MB while the object is active or cannot hibernate.
- SQLite: 25B rows read, 50M rows written and 5 GB-month included.

**Containers** [V containers/pricing, 2026-11-13]

| Resource | Included per month | Then |
|---|---|---|
| Memory | 25 GiB-hours | $0.0000025 per GiB-s |
| CPU | 375 vCPU-minutes | $0.000020 per vCPU-s |
| Disk | 200 GB-hours | $0.00000007 per GB-s |
| Egress (NA/EU) | 1 TB | $0.025 per GB |

- Billing is per 10 ms of active running and stops when the instance sleeps.
- Memory and disk are charged on what is provisioned; CPU is charged on actual use.
- The `basic` instance type is 1/4 vCPU, 1 GiB memory and 4 GB disk.
- Container logs are billed at the Workers Logs rate.

**Workers Logs** [V workers-logs page; observability/pricing]

- Until 2026-11-30: 20M events included, then $0.60 per million.
- From **2026-12-01**: Cloudflare Observability pricing. 50 GB ingestion and 10 GB-month storage are included, then $0.25 per GB ingested and $0.10 per GB-month.
- Either way this is about $0 at this volume.

**Workers Cache** [V workers/cache, 2026-10-30]

- No separate price. Every request, hit or miss, is billed at the Workers request rate.
- CPU is billed only when the Worker actually runs.
- With caching enabled, worker-to-worker (loopback) calls are billed as requests. The design below therefore costs **2 Worker requests per GET**, which is still far inside the 10M included.

### 1.2 What one awake `basic` container costs [I, computed from the rates above]

| Item | Cost |
|---|---|
| Memory | 1 GiB × 3600 s × $0.0000025 = **$0.0090 per hour** |
| Disk | 4 GB × 3600 s × $0.00000007 = **$0.0010 per hour** |
| Idle CPU (about 0.002 vCPU) | ≈ $0.00014 per hour |
| **Awake all month (730 h)** | ≈ **$7.0 above the plan**: memory $6.35 + disk $0.69 (the included 25 GiB-h and 200 GB-h cover only about 25 h) |
| One route (≈150 ms CPU) | ≈ 0.15 vCPU-s = $0.000003. The 375 included vCPU-minutes cover about 150k routes. |
| One cold start (≈20 s at ≤1/4 vCPU) | ≈ 5 vCPU-s, about $0.0001, plus 75 MB pulled from GitHub Pages |

- **Durable Object duration** while the container runs 24/7: 0.125 GB × 2.63M s = 329k GB-s, inside the 400k included.
- **The library's alarm loop** [C `container.js` `alarm()`] re-arms at most every 3 minutes while the container runs. That is about 20 DO requests and row writes per hour, which is negligible.

### 1.3 Realistic months

Assumptions [I]:

- Each request costs 150 ms of CPU in the container.
- Each response is about 8 KB.
- 2 Worker requests and about 2 ms of Worker CPU per call.
- Hours the container is awake grow with traffic. With `sleepAfter` of 15–30 minutes, scattered use keeps it up for a share of the day.

The model is in `/tmp/claude-0/-home-user-interway/89954242-6d28-54da-9f54-5a6aad91facb/scratchpad/cost.py`.

| Route requests per month | Hours awake (est.) | Workers | Durable Objects | Container memory + disk | Container CPU | Egress | **Total** |
|---|---|---|---|---|---|---|---|
| 1k | ~150 | $0 | $0 | $1.12 + $0.10 | $0 (≈2.7k vCPU-s, included) | $0 | **≈ $6.2** |
| 10k | ~450 | $0 | $0 | $3.83 + $0.40 | $0 (≈7.7k) | $0 | **≈ $9.2** |
| 100k | 730 (always awake) | $0 | $0 | $6.35 + $0.69 | $0 (≈20.6k, just inside) | $0 | **≈ $12.0** |
| 1M | 730 | $0 (2M requests) | ~$0.15 | $6.35 + $0.69 | $2.66 (≈155k vCPU-s) | $0 (8 GB) | **≈ $14.7–15** |

Notes:

- **Capacity is the real limit at 1M per month, not cost** [I]. Node runs routing on one thread, and `basic` has 1/4 vCPU. A 150 ms route (as measured on a full core) takes about 0.6 s, so one instance answers roughly 2–4 routes per second. 1M per month averages 0.4 per second, so peaks will queue.
- If that happens, `standard-1` (1/2 vCPU, 4 GiB) costs about $26 per month when always awake [I: 4 GiB × $0.009/h × 730 h]. It doubles CPU but quadruples the memory charge.
- Cache hits lower container CPU, but at ≥100k requests the container is awake all month anyway. Caching then helps latency and capacity more than cost.

### 1.4 Worst case: floods [I, computed]

One `basic` instance cannot burn more than 1/4 vCPU, so the container's cost is capped by time, not by request count:

- **≈ $0.24 per day** fully loaded: CPU $0.43 per day at the cap would include the free allowance; memory $0.22; disk $0.02.
- **≈ $20 per month** fully loaded.

Request charges are what scale with a flood.

| Scenario | Unprotected (today: every request goes Worker → DO → container) | With section 5 (per-IP limit at the gateway, only about 2 req/s reach the DO) |
|---|---|---|
| 100 req/s for **1 day** (8.64M requests) | +$2.1: DO requests $1.15, container about $1.0. Workers stay inside the included 10M. | +$0.3 |
| 100 req/s for a **whole month** (259M) | **≈ $143**: Workers $79, DO $39, container $20 | **≈ $106**: Workers $81, DO $0.6, container $20 |
| 1,000 req/s for a month (2.6B) | ≈ $1,240 | ≈ $850 |

- Unprotected, most flood requests also queue and time out, so real users get nothing.
- A Worker cannot avoid the $0.30 per million request charge: a request that reaches the Worker is billed even when it answers 429.
- Only a **WAF rule on a custom domain** (blocked before the Worker runs, so not billed as a Worker request [I]) or a **spending limit** caps that charge.
- A flood of 100 req/s from a few IPs may be below Cloudflare's automatic DDoS thresholds [I]. Do not count on DDoS mitigation for it.

### 1.5 Spend caps and alerts: yes, partly [V]

**Spending limits** (billing/manage/spend-management; workers/platform/spend-management; durable-objects/platform/spend-management; changelog 2026-06-05)

- Available **for Workers and for Durable Objects only**. "Support for more products is coming soon." Containers are not listed.
- Each limit counts usage charges above the included amounts and excludes the $5 fee.
- A **Workers limit** blocks every Worker on the account, which return error 1103. Rejected requests are not billed.
- A **Durable Objects limit** blocks new requests through a DO stub, SQL and new alarms. Running requests continue.
- Neither is exact: "A limit does not guarantee a maximum invoice amount… Blocking is not instantaneous."
- Blocks reset at the subscription renewal date.
- **Indirect Containers cap** [I]: when the DO limit blocks stub requests, the Worker can no longer reach the container. It then goes idle and sleeps after `sleepAfter`. That bounds container spend at about $0.24 per day after the block.

**Budget alerts** (billing/manage/budget-alerts; changelog 2026-04-13, 2026-06-15)

- An email when account-wide usage spend crosses a USD threshold. Informational only; it never blocks.
- Cloudflare turned them on by default for eligible Pay-as-you-go accounts. Check the threshold.
- The page does not say Containers are included, but the alert is account-wide usage spend.

**"Usage Based Billing" notification** (notifications/notification-available): threshold on one product metric. Needs a Pro plan or higher.

**How to set them up**

1. Dashboard → **Billing → Spend Management** → **Workers** row → Edit the spending limit → e.g. **$20** → Save. Repeat for **Durable Objects** (e.g. **$10**).
2. Dashboard-created limits have no email recipient. Add one with the `cf` CLI [V billing/manage/spend-management/cli]:

```sh
cf billing spend-policies create --name 'Workers $20 limit' --product-id workers \
  --enabled true --threshold-cents 2000 --action usage_block --notification-email you@example.com
cf billing spend-policies create --name 'DO $10 limit' --product-id durable_objects \
  --enabled true --threshold-cents 1000 --action usage_block --notification-email you@example.com
cf billing spend-policies create --name 'Workers $5 alert' --product-id workers \
  --enabled true --threshold-cents 500 --action notification --notification-email you@example.com
```

Notes on the CLI:

- One enabled limit per product.
- Emails go out at 80% and 100% of the threshold.
- `--dry-run` previews a command.

3. **Manage Account → Billing → Billable Usage → Create budget alert**, e.g. **$15** account-wide. This one covers Containers.

---

## 2. Anti-abuse and DDoS

**DDoS** [V ddos-protection/about]

- "Unmetered and unlimited" L3/L4/L7 DDoS protection "to all customers on all plans and services".
- The page does not mention workers.dev explicitly [I: it fronts all Cloudflare traffic].
- It will not stop a low-rate abuser.

**Workers Rate Limiting binding** [V workers/runtime-apis/bindings/rate-limit, 2026-11-12; C wrangler schema]

- Config: `"ratelimits": [{ "name", "namespace_id": "<positive int as string>", "simple": { "limit", "period": 10 | 60 } }]`.
- Call: `const { success } = await env.X.limit({ key })`.
- Requires Wrangler ≥ 4.36.0; you have 4.166.0.
- Counts are **per Cloudflare location** and eventually consistent. The limit is approximate and not global.
- The docs **advise against IP keys** because many users share IPs. A service without accounts has no other key, so use `cf-connecting-ip` with generous limits and add a global key (`"all"`) as a per-location circuit breaker.
- Price: not stated on the page. No separate rate-limit charge appears on the Workers pricing page [I: no extra cost; each request is a normal Worker request].
- Verified locally: 20/60 s returned 429 after the 20th request.

**WAF rate-limiting rules** [V waf/rate-limiting-rules]

| Plan | Rules | Characteristics | Counting period | Mitigation timeout |
|---|---|---|---|---|
| Free | **1** | IP only | 10 s | 10 s |
| Pro | 2 | IP only | up to 1 min | up to 1 h |
| Business | 5 | IP and IP with NAT support | up to 10 min | up to 1 day |

- WAF rules are zone-scoped [V waf/reference/phases].
- **A workers.dev hostname is not your zone, so WAF custom and rate-limiting rules cannot be attached to it** [I. The workers.dev docs are silent apart from Browser Integrity Check, which always applies there and cannot be turned off (V)].
- To use the WAF, put the Worker on a **custom domain** in a zone you own (free plan is fine). Then:
  - set `"workers_dev": false`;
  - add a free rule, e.g. `http.request.uri.path starts_with "/api/" or "/mcp"` → block when one IP makes more than 50 requests in 10 s;
  - requests blocked there never invoke the Worker [I].

**Turnstile** [V turnstile/]: "client-side… non-interactive JavaScript challenges" plus a browser widget or pre-clearance cookie. **Not usable for ChatGPT, Claude, MCP or script clients.** Skip it.

**Bot Fight Mode** [V bots/get-started/bot-fight-mode]

- Free, but zone-wide. It "may challenge API or mobile app traffic".
- It cannot be skipped with WAF custom rules or Page Rules, and only IP Access rules bypass it.
- Skip rules need Super Bot Fight Mode (paid).
- **Do not enable it on the API zone**: it would challenge the AI assistants you want to serve.

**Other edge settings**

- `"preview_urls": false`. It is a valid field [C schema], so version preview URLs do not expose extra hosts.
- Version and deployment URLs are not affected by `workers_dev` [V workers-dev page].

---

## 3. Caching

**Use Workers Cache, not `caches.default`.**

**Workers Cache** [V workers/cache, /configuration, /cache-keys, /limitations]

- Enable with `"cache": { "enabled": true }` (Wrangler ≥ 4.69). Per-entrypoint `"exports": { "<Name>": { "type": "worker", "cache": { "enabled": bool } } }` needs Wrangler ≥ 4.107.
- Cloudflare checks the cache **before invoking the Worker**. A hit runs no code, wakes no container and is billed as 1 request with no CPU.
- Only GET and HEAD are cached. A `Set-Cookie` response or an `Authorization` request bypasses the cache.
- TTL comes from `Cache-Control` (RFC 9111, including `stale-while-revalidate`).
- The cache is tiered (lower and upper tiers).
- The key is path + query string + entrypoint + `ctx.props` + **Worker version**. **The host is not in the key**, and **query order and trailing slashes matter**: there is no normalisation.
- `ctx.exports` loopback calls are cached, and `ctx.exports` is on by default since compatibility date 2025-11-17 [V compatibility-flags]. Your date is 2026-11-01, so no flag is needed.
- Responses are held to the Free-plan size limit at launch, and purges use Free-tier limits.

**Cache API (`caches.default`)** [V workers/runtime-apis/cache]

- The docs promise "functional cache operations" only on **custom domains**. workers.dev is not listed.
- It is local to one data center.
- It cannot store a response with `Set-Cookie`, and `put` throws on non-GET requests.
- It is fine on a custom domain but strictly weaker here. A minimal version, if wanted:

```ts
const cache = caches.default;
const key = new Request(normalisedUrl.toString());
let res = await cache.match(key);
if (!res) { res = await toContainer(...); if (res.ok) ctx.waitUntil(cache.put(key, res.clone())); }
```

**Design used in section 5**

- An uncached `default` entrypoint does three things:
  1. Rejects URLs over 2 KB and checks the per-IP limit.
  2. **Normalises** the URL: keeps only known parameters, sorts them, trims and collapses whitespace, lowercases `from`, `to` and `q`, and drops junk such as `utm_*`.
  3. Calls `ctx.exports.Cached.fetch(normalisedUrl)`.
- `Cached` runs **only on a miss**. It applies the miss limits, calls the container and sets `Cache-Control`.
- Lowercasing changes the casing of names echoed in the "Service link". The place resolver already folds case, so routes are unchanged [C engine.ts `fold`]. Drop the lowercasing if the echo matters.

**TTLs** [I]

- Briefs are deterministic: nothing in brief, routing or service reads `Date.now()` or `new Date()` [C grep]. Output depends only on the request and the data.
- Use `max-age=86400, stale-while-revalidate=3600` for 200s on `/api/route`, `/api/place` and `/api/waterway`.
- Use 3600 for `/` and `/llms.txt`, and 3600 for 400/404.
- Never cache 429 or 5xx (`no-store`).
- A redeploy changes the Worker version, which empties the cache. Keep `cross_version_cache` off.
- **Set `SERVICE_URL`** (via container `envVars`). The host is not in the cache key, so otherwise a brief cached from one hostname would carry that hostname's links to callers on another.

**MCP** is POST and is not cached. Optional (P3): in the gateway, parse `tools/call` with `plan_route`, build the equivalent `/api/route` URL, fetch it through `Cached`, and wrap the text in a JSON-RPC result. `routeText()` is identical for both paths [C handler.ts].

---

## 4. App-level hardening (Node service)

Findings in the current code [C]:

1. **Unbounded body**: `server.ts` `body()` concatenates every chunk, so a large POST can exhaust the 1 GiB container (Node heap is capped at 768 MB).
2. **JSON-RPC batches are accepted** and run with `Promise.all`. One POST can hold hundreds of `plan_route` calls and bypass every per-request limit.
   - The **MCP 2025-06-18 revision removed batching** [V modelcontextprotocol.io/specification/2025-06-18/changelog], and the transport spec says the POST body "MUST be a single JSON-RPC request, notification, or response" [V basic/transports].
   - Reject arrays with HTTP 400.
3. **No cap on `via` stops**, on name lengths, or on `q` and `query`. Each stop may call Photon in sequence, and `routeVia` CPU grows with the number of legs.
4. **Geocoder** (`ui/search.ts` `searchPlaces`): no timeout, no cache and no global budget.
   - Photon's terms: "please be fair - extensive usage will be throttled… We do not guarantee for the availability" [V photon.komoot.io].
   - A flood of made-up place names would make **your container** abuse Photon.
5. **Error leakage**:
   - `server.ts` returns `Internal error: ${e.message}`.
   - MCP `one()` returns any `Error.message` as -32603.
   - The containers library returns `Failed to start container: <message>` with status 500 [C container.js `containerFetch`].
6. **Cold-start race**: the library waits **20 s** (`TIMEOUT_TO_GET_PORTS_MS = 20_000`) for the port [C], and the server listens only after loading about 75 MB (≈20 s). First requests can fail.
   - Fixed in section 5 by `startAndWaitForPorts({ cancellationOptions: { portReadyTimeoutMS: 90_000 } })`.
7. **No concurrency limit or timeouts**. Routing is synchronous and CPU-bound on one thread, so a queue of 50 requests means waits of 30 s or more. Fail fast with 503 and `Retry-After` instead.

Recommended limits:

| Limit | Where | Value |
|---|---|---|
| URL length | Worker | 2,048 chars → 414 |
| `/mcp` body | Worker and Node | 32 KB → 413 |
| `from`, `to`, each via, `q`, `query`, `link`, `id` | handler/engine | ≤ 200 chars (link ≤ 2,000) |
| via stops | engine `parseRequest` and `applyEdit` | ≤ 10 |
| Online geocoder lookups per request | engine `resolvePlace` | ≤ 3; past that, give coordinates |
| Concurrency | DO (Worker) + Node | ≤ 6 in flight at the DO; ≤ 4 queued in Node → 503 `Retry-After: 30` |
| Node timeouts | `server.ts` | `requestTimeout` 30 s, `headersTimeout` 10 s, `keepAliveTimeout` 5 s |
| Photon | `search.ts` | 3 s timeout, LRU cache of 5,000 queries for 24 h, global ≤ 1 call/s, in-flight dedupe |

**CORS**

- `access-control-allow-origin: *` is correct for a public, credential-free, read-only API. Keep it.
- Never add `allow-credentials`. Keep the methods to `GET, POST, OPTIONS`.

**MCP Origin rule**

- The spec says servers "MUST validate the Origin header" against DNS rebinding [V transports]. That attack targets **local** servers.
- For this public, no-auth, read-only server [I], allow a missing Origin (server-side clients) and allow any Origin (no credentials, nothing to steal).
- Optionally reject Origins on a denylist. Do not add an allowlist: it would break browser-hosted clients.

**Logging without personal data**

- `"observability": { "redact_query_string": true }` [C schema field] keeps typed place names out of Worker logs.
- Do not forward `cf-connecting-ip` to the container. Section 5 forwards only the content-type, accept and MCP headers.
- In Node, log status, path, duration and the data id. Never log query strings, MCP arguments or IPs.
- Retention is 7 days by default [V].

**MCP / prompt-injection notes** [I]

- **Output is mostly yours**: briefs, waterway sheets and the help text.
- **Untrusted text enters the output in three ways**:
  1. Place names the caller typed are echoed in the title, in errors (`No place found for from "…"`) and in the service link.
  2. **Photon labels**, which are OpenStreetMap names anyone can edit, appear in the title and in `find_place`.
  3. `edit_route` accepts an attacker-supplied link whose parameters are echoed back.
- **The realistic risk**: someone shares a crafted service link, and the victim's assistant calls it. The response then carries "ignore previous instructions…" inside a `from` name.
- **Mitigation**:
  - Cap echoed names at 100–200 chars.
  - Strip control characters and newlines.
  - Neutralise Markdown and HTML (`[]()<>` and backticks) in **every** echoed or third-party string.
  - Quote echoed input as data (`from "…"`).
  - Never echo untrusted text in the `instructions` field.
- `requestFromLink` only parses the URL and never fetches it [C], so there is **no SSRF**. Keep it that way.
- Tool results are read-only data with no side effects, which limits the damage injection can do.
- `get_waterway` takes only exact ids, and the Worker can whitelist `id` with `/^[a-z0-9-]{1,64}$/`.

**`sleepAfter`, cold starts and `max_instances`** [I, from 1.2]

- An awake hour costs about **$0.010**, so the 30-minute tail after each burst is about $0.005. The spread between "always asleep" and "always awake" is only about **$7 per month**.
- A cold start costs about 20 s+ of user latency, plus 75 MB pulled from GitHub Pages on each start.
- An assistant conversation (plan, then several `edit_route` calls) spans minutes, so **15–30 minutes is right**. 15 minutes saves about $1–2 per month at low traffic, and 30 minutes is better UX. Either is fine; the draft uses 15 minutes.
- The real fix for cold starts is to bake the data into the image or snapshot it. Snapshots are free during the beta [V containers/pricing].
- **`max_instances`**:
  - `getContainer(env.SERVICE, 'interway')` always addresses **one** named instance [C utils.d.ts], so `max_instances: 2` never gives two serving instances.
  - Keep 2 as headroom for rollouts and a bill ceiling: about $40 per month for two pegged `basic` instances [I].
  - For real horizontal scale use `getRandom(env.SERVICE, 2)`. Each instance loads its own data, which doubles memory cost.
- **Optional egress lock** [C README]: `allowedHosts = ['abecadel.github.io', 'photon.komoot.io']` blocks everything else with HTTP 520. For HTTPS it requires `interceptHttps = true` and trusting `/etc/cloudflare/certs/cloudflare-containers-ca.crt` (e.g. `NODE_EXTRA_CA_CERTS`). That is low priority, because the service never fetches user-supplied URLs.

---

## 5. Prioritised checklist with snippets

### P0: today, no code

1. **Spending limits**: Workers $20, Durable Objects $10, plus a **budget alert** of $15 and a Workers notification at $5 (commands in 1.5).
2. Turn on email for the limits with `cf billing spend-policies … --notification-email`.

### P1: `wrangler.jsonc`

Validated with `wrangler deploy --dry-run`, wrangler 4.166.0.

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "interway",
  "main": "worker.ts",
  "compatibility_date": "2026-11-01",
  "workers_dev": true,          // false once a custom domain + WAF rule is in place
  "preview_urls": false,
  // Workers Cache: hits never run the Worker, so they never reach the rate limits or the container.
  "cache": { "enabled": true },
  "exports": {
    "default": { "type": "worker", "cache": { "enabled": false } },
    "Cached": { "type": "worker", "cache": { "enabled": true } }
  },
  "ratelimits": [
    // per caller (cf-connecting-ip), per Cloudflare location, cache hits included
    { "name": "PER_IP", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } },
    // per caller: requests that reach the container (cache misses and MCP calls)
    { "name": "MISS_IP", "namespace_id": "1002", "simple": { "limit": 20, "period": 60 } },
    // everyone, per location: about what one 1/4-vCPU container can answer
    { "name": "ALL", "namespace_id": "1003", "simple": { "limit": 120, "period": 60 } }
  ],
  "limits": { "cpu_ms": 1000 },
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "redact_query_string": true   // place names are in the query string
  },
  "containers": [
    {
      "class_name": "InterwayService",
      "image": "./Dockerfile",
      "instance_type": "basic",
      // the Worker addresses one named instance ("interway"); 2 leaves room for a rollout and caps the bill
      "max_instances": 2
    }
  ],
  "durable_objects": { "bindings": [{ "name": "SERVICE", "class_name": "InterwayService" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["InterwayService"] }]
}
```

### P1: `worker.ts`

Type-checked against workers-types and containers 0.3.7, and smoke-tested in `wrangler dev`. Replace `SERVICE_URL` with the real workers.dev or custom-domain address.

```ts
// Cloudflare Worker in front of the route service. The default entrypoint (never cached) normalises the URL and
// sends cacheable GETs to the Cached entrypoint, which Workers Cache serves without running code on a hit; only a
// miss runs Cached, applies the rate limits and wakes the container.
import { WorkerEntrypoint } from 'cloudflare:workers';
import { Container, getContainer } from '@cloudflare/containers';

const MAX_INFLIGHT = 6; // requests queued at the container at once; more get 503 straight away

export class InterwayService extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '15m';
  envVars = { SERVICE_URL: 'https://interway.example.workers.dev', MAX_VIA: '10' };
  private inflight = 0;

  override async fetch(request: Request): Promise<Response> {
    if (this.inflight >= MAX_INFLIGHT) return busy('The route service is busy');
    this.inflight++;
    try {
      // the service listens only once its data is loaded (about 20 s): wait longer than the library's 20 s default
      if ((await this.getState()).status !== 'healthy') {
        await this.startAndWaitForPorts({ ports: this.defaultPort, cancellationOptions: { portReadyTimeoutMS: 90_000, abort: request.signal } });
      }
      const res = await super.fetch(request);
      // container/start failures carry internal messages: say less
      return res.status >= 500 ? busy('The route service is unavailable', 60) : res;
    } catch (e) {
      console.error('container fetch failed', (e as Error).message);
      return busy('The route service is starting', 30);
    } finally {
      this.inflight--;
    }
  }
}

interface Env {
  SERVICE: DurableObjectNamespace<InterwayService>;
  PER_IP: RateLimit; // every request per caller per Cloudflare location: rejects floods before they cost a second request
  MISS_IP: RateLimit; // requests per caller that reach the container
  ALL: RateLimit; // requests from everyone that reach the container, per location: a circuit breaker
}

const ROUTE_PARAMS = ['from', 'to', 'via', 'draft', 'air', 'beam', 'len', 'speed', 'current', 'lockmin', 'date', 'avoidLocks', 'avoidSea', 'coastal', 'format'];
const KEEP: Record<string, string[]> = { '/api/route': ROUTE_PARAMS, '/api/place': ['q'], '/api/waterway': ['id'], '/': [], '/llms.txt': [] };
const TTL: Record<string, number> = { '/api/route': 86400, '/api/place': 86400, '/api/waterway': 86400, '/': 3600, '/llms.txt': 3600 };
const MAX_URL = 2048, MAX_BODY = 32 * 1024;

function busy(msg: string, retry = 30): Response {
  return new Response(`${msg}; try again in ${retry} s.\n`, {
    status: 503, headers: { 'retry-after': String(retry), 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
  });
}
const tooMany = () => new Response('Too many requests; slow down.\n', {
  status: 429, headers: { 'retry-after': '60', 'cache-control': 'no-store', 'access-control-allow-origin': '*' },
});

/** The same question always gives the same URL: only known parameters, sorted, trimmed, one value each. */
function normalise(url: URL): URL | null {
  const keep = KEEP[url.pathname];
  if (!keep) return null;
  const out = new URL(url.origin + url.pathname);
  for (const k of [...keep].sort()) {
    const v = url.searchParams.get(k)?.trim().replace(/\s+/g, ' ');
    if (v) out.searchParams.set(k, k === 'from' || k === 'to' || k === 'q' ? v.toLowerCase() : v);
  }
  return out;
}

/** For requests that will reach the container. */
async function limited(env: Env, ip: string): Promise<Response | null> {
  const [one, all] = await Promise.all([env.MISS_IP.limit({ key: ip }), env.ALL.limit({ key: 'all' })]);
  return one.success && all.success ? null : tooMany();
}

function toContainer(env: Env, request: Request, url: URL): Promise<Response> {
  // only the headers the service needs: no cookies, no client IP into the container
  const headers = new Headers({ 'x-forwarded-origin': url.origin });
  for (const h of ['content-type', 'accept', 'mcp-protocol-version', 'mcp-session-id']) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  return getContainer(env.SERVICE, 'interway').fetch(new Request(url, { method: request.method, headers, body: request.body }));
}

/** Runs only on a Workers Cache miss. */
export class Cached extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stop = await limited(this.env, request.headers.get('x-client-ip') ?? 'unknown');
    if (stop) return stop;
    const res = await toContainer(this.env, request, url);
    const out = new Response(res.body, res);
    out.headers.delete('set-cookie');
    // answers depend only on the request and the data: cache successes for a day, mistakes (400/404) for an hour
    const ttl = res.ok ? TTL[url.pathname] ?? 3600 : res.status === 400 || res.status === 404 ? 3600 : 0;
    out.headers.set('cache-control', ttl ? `public, max-age=${ttl}, stale-while-revalidate=3600` : 'no-store');
    return out;
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.url.length > MAX_URL) return new Response('URL too long\n', { status: 414 });
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    // the only key a service without accounts has; generous, since NAT and assistants' egress IPs are shared
    if (!(await env.PER_IP.limit({ key: ip })).success) return tooMany();
    if (request.method === 'GET' || request.method === 'HEAD') {
      const key = normalise(url);
      if (!key) return new Response(`Not found: ${url.pathname}. See ${url.origin}/\n`, { status: 404, headers: { 'cache-control': 'public, max-age=3600' } });
      return ctx.exports.Cached.fetch(new Request(key, { method: request.method, headers: { 'x-client-ip': ip } }));
    }
    if (request.method === 'OPTIONS') return toContainer(env, request, url);
    if (request.method !== 'POST' || url.pathname !== '/mcp') return new Response('Method not allowed\n', { status: 405, headers: { allow: 'GET, HEAD, POST, OPTIONS' } });
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return new Response('Body too large\n', { status: 413 });
    const body = await request.arrayBuffer(); // chunked bodies have no length: read, then check
    if (body.byteLength > MAX_BODY) return new Response('Body too large\n', { status: 413 });
    const stop = await limited(env, ip);
    if (stop) return stop;
    return toContainer(env, new Request(request, { body }), url);
  },
} satisfies ExportedHandler<Env>;

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./worker');
      durableNamespaces: 'InterwayService';
    }
  }
}
```

Behaviour checked in `wrangler dev`:

- `?to=Monaco&from=Wrocław&junk=1&utm=x` reached the container as `/api/route?from=wroc%C5%82aw&to=monaco`.
- An unknown path got 404 without waking the container.
- A 40 KB POST got 413.
- A chunked MCP POST passed.
- The 19th–25th requests from one IP got 429. In that run PER_IP and MISS_IP each counted 2 earlier requests, so MISS_IP tripped first.

Two caveats:

- Local tests do not exercise Workers Cache [V limitations]. Verify hits after deploy with `curl -sI` twice and compare timing and any cache-status header.
- The `PER_IP` check runs before the loopback, so a rejected flood request costs 1 Worker request, not 2.

### P1: `handler.ts` and `server.ts` (sketches, not compiled)

```ts
// handler.ts — in mcp(): MCP 2025-06-18 removed batching; one message per POST
if (Array.isArray(body)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Batching is not supported: send one JSON-RPC message per request' } }, 400);
// in one(): never return internal messages
} catch (e) {
  const known = e instanceof RequestError || (e as { code?: number }).code === -32601;
  if (!known) console.error('rpc failed', m.method, (e as Error).stack);
  return { jsonrpc: '2.0', id: m.id, error: { code: (e as { code?: number }).code ?? -32603, message: known ? (e as Error).message : 'Internal error' } };
}
// find_place / /api/place / get_waterway: cap inputs
const q = String(a.query ?? '').slice(0, 100);
if (!/^[a-z0-9-]{1,64}$/.test(id)) throw new RequestError('Unknown waterway id');
```

```ts
// engine.ts — parseRequest(): caps
const MAX_NAME = 200, MAX_VIA = Number(process.env.MAX_VIA ?? 10);
if (from.length > MAX_NAME || to.length > MAX_NAME) throw new RequestError(`Place names are at most ${MAX_NAME} characters`);
if (via.length > MAX_VIA) throw new RequestError(`At most ${MAX_VIA} stops`);
if (via.some((v) => v.length > MAX_NAME)) throw new RequestError(`Place names are at most ${MAX_NAME} characters`);
// applyEdit(): same check after add_stop. requestFromLink(): if (link.length > 2000) throw new RequestError('link too long')
// plan(): count online lookups; after 3 per request throw RequestError('Too many unknown names: give lon,lat for some stops')

/** Text from users or OpenStreetMap that goes back to an assistant: one short line, no markup. */
export const clean = (s: string, n = 120) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[`<>\[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
// use clean() on Photon labels in resolvePlace(), on echoed names in error messages and the brief title
```

```ts
// ui/search.ts (or a server-only wrapper passed to loadEngine): Photon timeout, cache, budget, dedupe
const cache = new Map<string, { at: number; v: Place[] }>(), inflight = new Map<string, Promise<Place[]>>();
let last = 0;
export async function geocodeCached(query: string): Promise<Place[]> {
  const k = query.trim().toLowerCase().slice(0, 100);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 86_400_000) return hit.v;
  if (inflight.has(k)) return inflight.get(k)!;
  if (Date.now() - last < 1000) return [];            // global budget: ≤ 1 call/s to Photon; else local results only
  last = Date.now();
  const p = searchPlaces(k, undefined, AbortSignal.timeout(3000)).catch(() => [] as Place[])
    .then((v) => { cache.set(k, { at: Date.now(), v }); if (cache.size > 5000) cache.delete(cache.keys().next().value!); return v; })
    .finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}
// main(): loadEngine(dataReader(env), env.GEOCODE === '0' ? undefined : geocodeCached)
```

```ts
// server.ts — body cap, concurrency cap, timeouts, no leaked errors
const MAX_BODY = 32 * 1024, MAX_QUEUE = 4;
let active = 0;
async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}
// in the request callback, before handle():
if (active >= MAX_QUEUE) { res.writeHead(503, { 'retry-after': '30', 'content-type': 'text/plain' }); res.end('Busy, try again in 30 s\n'); return; }
active++; res.on('close', () => active--);
// catch:
const status = (e as { status?: number }).status ?? 500;
if (status === 500) console.error((e as Error).stack);
res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
res.end(status === 413 ? 'Body too large\n' : 'Internal error\n');
// after createServer():
server.requestTimeout = 30_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000;
```

### P2

- **Custom domain** for the API (a free zone) with `"workers_dev": false` and **one free WAF rate-limiting rule**: path `/api/` or `/mcp`, more than 50 requests per 10 s per IP, block for 10 s. That blocks floods before they are billed as Worker requests. Do **not** enable Bot Fight Mode on that zone.
- Set a `SERVICE_URL` that matches the canonical host. Links in cached answers then never point at the wrong host.
- Node logging: one line per request with status, path, ms and data id. No query, arguments or IPs.

### P3

- Serve MCP `plan_route` through the `Cached` entrypoint (section 3).
- Bake the data into the image or use snapshots to cut the 20 s cold start.
- Egress allow-list (`allowedHosts` + `interceptHttps`).
- `getRandom(env.SERVICE, 2)`, or `standard-1`, if routes per second outgrow one `basic` instance.

---

## Sources (official)

**Cloudflare: pricing and billing**

- developers.cloudflare.com/workers/platform/pricing/
- developers.cloudflare.com/containers/pricing/
- developers.cloudflare.com/containers/platform-details/limits/
- developers.cloudflare.com/containers/platform-details/architecture/
- developers.cloudflare.com/billing/manage/spend-management/ (+ /cli/)
- developers.cloudflare.com/workers/platform/spend-management/
- developers.cloudflare.com/durable-objects/platform/spend-management/
- developers.cloudflare.com/billing/manage/budget-alerts/
- developers.cloudflare.com/notifications/notification-available/
- developers.cloudflare.com/workers/observability/logs/workers-logs/
- developers.cloudflare.com/observability/pricing/

**Cloudflare: Workers runtime and caching**

- developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- developers.cloudflare.com/workers/cache/ (+ /configuration/, /cache-keys/, /limitations/, /examples/)
- developers.cloudflare.com/workers/runtime-apis/cache/
- developers.cloudflare.com/workers/reference/how-the-cache-works/
- developers.cloudflare.com/workers/runtime-apis/context/
- developers.cloudflare.com/workers/configuration/compatibility-flags/
- developers.cloudflare.com/workers/configuration/routing/workers-dev/

**Cloudflare: security**

- developers.cloudflare.com/waf/rate-limiting-rules/
- developers.cloudflare.com/waf/reference/phases
- developers.cloudflare.com/ddos-protection/about/
- developers.cloudflare.com/bots/get-started/bot-fight-mode/
- developers.cloudflare.com/turnstile/

**Other**

- modelcontextprotocol.io/specification/2025-06-18/changelog
- modelcontextprotocol.io/specification/2025-06-18/basic/transports
- photon.komoot.io (terms of use)
