# Ward Helper Agents

## Source of truth

- Runtime-источник для вардов: `scripts_files/data/ward_reco_dataset.runtime.json`.
- Основной билдер пайплайна: `build_ward_reco_runtime.py`.
- Ежедневный сборщик запускается через `.github/workflows/update-wards.yml`.

## Текущая модель данных (schema v5)

- Match-данные обрабатываются в `PlacementSample` и агрегируются в споты.
- Группировка И ранжирование идут ТОЛЬКО по `team + ward type + time_bucket`.
- Тайм-бакеты: `0_12`, `12_25`, `25_50`, `50_plus`.
- Ранжирование (`score`) = популярность × выживаемость варда (`quick_deward_rate`/`success_rate`) × spread. Состояние карты не учитывается.
- Состояние карты (tower-state, gold/kill advantage, pressure, lane_stages) и весь `context_profiles` удалены из сбора, датасета и рантайма.
- В кэш-записи хранится сырое `event_time_sec` — бакеты ре-деривятся при сборке рантайма.
- Источник матчей: только парсенные (`version IS NOT NULL`).

## Пайплайн 5-дневного окна

- На каждый ежедневный запуск делается fetch до 500 свежих парсенных матчей.
- Каждый день создаётся файл `scripts_files/data/ward_reco_match_cache_daily/YYYY-MM-DD.json`.
- Runtime собирается из последних `N` дневных файлов через `--build-from-daily-batches`.
- По умолчанию используется `N=5` через `--daily-batches-for-runtime 5`.
- Старые дневные файлы обрезаются до окна хранения в workflow.

## Режимы и флаги билдера

- `--emit-daily-batch` включает запись дневного файла.
- `--build-from-daily-batches` заставляет строить runtime только из дневных файлов.
- `--daily-batches-for-runtime N` переопределяет размер окна.
- `--daily-batch-retention N` задаёт сколько дневных файлов держать.
- `--dedup-from-daily-cache` включает дедупликацию новых матчей против последних дневных батчей.
- `--daily-dedup-retention N` задаёт окно для дедупа.
- `--skip-match-cache` отключает чтение/запись `cache-dir` для этого запуска.
- `--skip-runtime-build` завершает процесс после записи дневного батча.

## Структура файлов

- `build_ward_reco_runtime.py`
- `.github/workflows/update-wards.yml`
- `scripts_files/data/ward_reco_dataset.runtime.json`
- `scripts_files/data/ward_reco_match_cache_daily/`
- `src/model/WardDataLoader.ts`
- `src/model/VisibleWardSelector.ts`
- `src/model/WardSpawner.ts`

## Инварианты

- Один рантайм-источник: `ward_reco_dataset.runtime.json`.
- В in-game pipeline не используются legacy remote sources и recommendation assets.
- В ежедневном action не запускаются debug render-скрипты.
- Если данных меньше, чем окно в 5 дней, используется доступный объём без hard-fail.
- Любые изменения формата `ward_reco_dataset.runtime.json` нужно синхронизировать с `WardDataLoader` и `VisibleWardSelector`.
- Тайм-бакеты `TIME_BUCKETS` в сборщике и `WardSpawner.GetCurrentTimeBucket` должны совпадать.

## Ограничения

- Качество output зависит от полноты и качества событий с вардов в OpenDota-сырье.
- `ward_reco_match_cache_files/` может использоваться только в legacy/локальном инкрементальном режиме; основной daily workflow опирается на `ward_reco_match_cache_daily`.

## План изменений

- Держать offline absolute-scenario и compare manifests как постоянный validation workflow.
- Добавить более гибкий retention-policy, если понадобятся другие частоты сборок.
- Добавить контроль размера датасета/батча и ранний warning в workflow.
