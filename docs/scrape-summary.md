# Shopee Mall scrape summary

**Stopped:** 2026-07-29 (SGT; captcha again — Chrome closed, harvest processes killed)  
**Prior stop:** 2026-07-28T11:06:34Z (first captcha stop)
**Workspace:** `c21c057f-ea01-4e19-bc79-fafcf2626b19`
**Mode:** single-brand Mall only · warm Chrome CDP `--connect :9222` · humanize cadence
**List:** `--list-mode both` · `--max-pages 2`
**MH-4:** started at top **10**, then raised to **40** for later brands (few completed at 40 before stop)

## Headline

| Metric | Count |
|--------|------:|
| Linked brand rows (shop set) | 84 |
| Unique shops | 75 |
| Single-brand shops | 73 |
| Multi-brand distributor shops | 2 (11 brand rows) |
| **List harvest OK** (single-brand, as of 2026-07-29 stop) | **~19** |
| Single-brand still need list | **~51** |
| Distributor brands still need list | ~7 |
| On cooldown / skipped (stuck or fail) | anua, dear-dahlia, dear-klairs (check expiry) |
| List OK but MH-4 thin (redo later) | many early brands + amuse/celimax/BOJ etc. |

## List harvest complete

| Brand | Products | MH-4 PDPs | Shop |
|-------|---------:|----------:|------|
| 3ce | 215 | 10 | 3cesg |
| abib | 98 | 1 | beautyhaussg |
| aestura | 46 | 1 | younfamily.sg |
| ahc | 98 | 1 | beautyhaussg |
| aplb | 98 | 0 (fail) | beautyhaussg |
| april-skin | 37 | 0 | aprilskin_official |
| arencia | 62 | 10 | arencia.sg |
| arocell | 39 | 10 | arocell.sg |
| axis-y | 67 | 0 | axisysg |
| beauty-of-joseon | 108 | 0 | beautyofjoseonsg |
| biodance | 100 | 10 | biodance.sg |
| cosrx | 173 | 10 | cosrx.sg |

## Stopped / cooldown (retry later)

| Brand | Reason | Cooldown until |
|-------|--------|----------------|
| amuse | skipped_stuck_page1 | 2026-07-28T14:20:04.301Z |
| anua | skipped_stuck_73min | 2026-07-28T15:34:07.980Z |
| banila-co | queue_fail_exit_124 | 2026-07-28T16:42:04.107Z |

## Single-brand still need list harvest

- `amuse`
- `anua`
- `banila-co`
- `benton`
- `beplain`
- `bouquet-garni`
- `celimax`
- `centellian24`
- `chill-lab`
- `cnp-laboratory`
- `dalba`
- `dear-dahlia`
- `dear-klairs`
- `dr-althea`
- `dr-forhair`
- `dr-melaxin`
- `dr-reju-all`
- `elroel`
- `florasis`
- `flower-knows`
- `fwee`
- `glad2glow`
- `goongbe`
- `grafen`
- `haruharu-wonder`
- `house-of-hur`
- `isntree`
- `joocyee`
- `judydoll`
- `julyme`
- `jumiso`
- `jung-saem-mool`
- `kopher`
- `kundal`
- `laka`
- `laneige`
- `lilyeve`
- `makeprem`
- `medicube`
- `mediheal`
- `mixsoon`
- `mizon`
- `nard`
- `numbuzin`
- `o-two-o`
- `parnell`
- `pyunkang-yul`
- `rejuran`
- `round-lab`
- `seapuri`
- `skin1004`
- `skinfood`
- `skintific`
- `somebymi`
- `sulwhasoo`
- `tfit`
- `timage`
- `tirtir`
- `tocobo`
- `too-cool-for-school`
- `torriden`
- `unove`
- `vt-cosmetics`
- `wakemake`
- `wellage`

## Multi-brand distributors (deferred this pass)

Queue ran with **`--single-brand-only`** after early distributor friction.

### @beautyhaussg
- Brands: abib, ahc, aplb, hera, iunik, purcell
- List done: abib, ahc, aplb
- Still need: hera, iunik, purcell

### @younfamily.sg
- Brands: aestura, aromatica, elizavecca, hince, ilso
- List done: aestura
- Still need: aromatica, elizavecca, hince, ilso

## MH-4 redo (platform category on more PDPs)

List data is fine; deepen PDP sample to **≥40** (or full top-N) later.

```
node scripts/_mark_mh4_redo.mjs --target 40
```

| Brand | list | mh4 |
|-------|-----:|----:|
| 3ce | 215 | 10 |
| abib | 98 | 1 |
| aestura | 46 | 1 |
| ahc | 98 | 1 |
| aplb | 98 | 0 |
| april-skin | 37 | 0 |
| arencia | 62 | 10 |
| arocell | 39 | 10 |
| axis-y | 67 | 0 |
| beauty-of-joseon | 108 | 0 |
| biodance | 100 | 10 |
| cosrx | 173 | 10 |

## Ops notes (this session)

- **Warm connect** Chrome CDP reduces cold Puppeteer — captcha usually once per session then OK.
- **Humanize:** session-first 5–15s warm-up; short gaps when warm; brand gaps; post-block cool-down.
- **Stall kill:** 18 min no log output → skip brand (code 124) + 6h cooldown so queue advances.
- **Brand hard cap:** 90 min after mh4-top raised to 40.
- **Sleep:** machine sleep freezes CDP mid-page — leave awake during harvest.
- **Captcha:** stop for day when triggered hard; do not thrash session.
- Scripts: `scripts/_harvest_queue.mjs`, `scripts/mall-brand-cycle.mjs`, `scripts/start-shopee-chrome-cdp.ps1`
- State: `.mall-cycle-state.json` · log: `.harvest-queue.log` · redo: `.mh4-redo.json`

## Resume command (next session)

1. Start warm Chrome: `pwsh scripts/start-shopee-chrome-cdp.ps1`
2. Confirm CDP: `http://127.0.0.1:9222/json/version`
3. Queue (single-brand, mh4 40):

```
node scripts/_harvest_queue.mjs -w c21c057f-ea01-4e19-bc79-fafcf2626b19 --connect --list-mode both --max-pages 2 --mh4-top 40 --single-brand-only --brand-timeout-min 90 --stall-timeout-min 18
```

4. Later: distributors with `--include-distributors`; MH-4 deepen from `.mh4-redo.json`.

## Related

- Runbook: `docs/MALL_BRAND_CYCLE_RUNBOOK.md`
- Track BR in `TODO.md`
