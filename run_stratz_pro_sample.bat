@echo off
setlocal

cd /d "%~dp0"

python stratz_monthly_ward_sample.py ^
  --match-source pro ^
  --days-back 30 ^
  --max-matches 40 ^
  --top-per-team 0 ^
  --min-count 2 ^
  --min-distance 201 ^
  --step 1 ^
  --first-split-sec 720 ^
  --second-split-sec 1920 ^
  --print-distances ^
  %*

endlocal
