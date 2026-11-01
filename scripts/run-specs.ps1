<#
  Runs specs one after another, unattended: plan -> build -> verify -> fix -> re-verify -> commit.
  Usage (from the repo root, in PowerShell):
      powershell -ExecutionPolicy Bypass -File scripts\run-specs.ps1            # specs 6 to 10
      powershell -ExecutionPolicy Bypass -File scripts\run-specs.ps1 -From 6 -To 7
  Stops at the first spec that is blocked or still failing. Shows a Windows notification at the end.
#>
param(
  [int]$From = 6,
  [int]$To = 10,
  [int]$MaxFixRounds = 2,
  [string]$Branch = "auto/specs-$From-to-$To"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$stamp  = Get-Date -Format "yyyy-MM-dd_HH-mm"
$logDir = Join-Path $repo "test-results\auto-run_$stamp"
New-Item -ItemType Directory -Force $logDir | Out-Null
$summary = Join-Path $logDir "SUMMARY.md"
$results = @()

function Notify($title, $text) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    $n = New-Object System.Windows.Forms.NotifyIcon
    $n.Icon = [System.Drawing.SystemIcons]::Information
    $n.Visible = $true
    $n.ShowBalloonTip(15000, $title, $text, [System.Windows.Forms.ToolTipIcon]::Info)
    [console]::Beep(800, 300); [console]::Beep(1000, 300)
    Start-Sleep -Seconds 5
    $n.Dispose()
  } catch { }
}

function Finish($ok, $msg) {
  $lines = @("# Auto-run $From to $To ($stamp)", "", "**$msg**", "")
  $lines += $results | ForEach-Object { "- $_" }
  $lines | Set-Content -Path $summary -Encoding utf8
  Write-Host "`n$msg`nSummary: $summary"
  Notify ($(if ($ok) { "Specs $From-$To finished" } else { "Specs run stopped" })) $msg
  if ($ok) { exit 0 } else { exit 1 }
}

function Invoke-Claude($prompt, $logName) {
  $log = Join-Path $logDir $logName
  $out = & claude -p $prompt `
      --permission-mode acceptEdits `
      --allowedTools "Bash,Read,Edit,Write,Glob,Grep,Skill,Agent" `
    | Tee-Object -FilePath $log
  if ($LASTEXITCODE -ne 0) { throw "claude exited with code $LASTEXITCODE (see $log)" }
  return ($out -join "`n")
}

# --- safety checks ------------------------------------------------------------
if (git status --porcelain) {
  Finish $false "Working tree is not clean. Commit or stash your changes (e.g. spec 05) first, then re-run."
}
git checkout -B $Branch | Out-Null

$common = @"
You are running UNATTENDED. Nobody can answer questions or approve plans, so never ask and never wait.
Follow .claude/CLAUDE.md and the project skills. Do not commit (the script commits).
If an open question in the PRD or anything unclear BLOCKS the work, do not guess: stop and make the last line of your reply
'RESULT: BLOCKED - <reason>'.
"@

foreach ($n in $From..$To) {
  $prefix = "{0:00}" -f $n
  $file = Get-ChildItem ".claude\specs" -Filter "$prefix-*.md" | Select-Object -First 1
  if (-not $file) { Finish $false "No spec file starting with $prefix found in .claude/specs." }
  $name = $file.BaseName
  Write-Host "`n=== Spec $name ===" -ForegroundColor Cyan

  try {
    # 1. plan + build ----------------------------------------------------------
    $p1 = @"
$common
Follow the instructions in .claude/commands/plan-spec.md for spec '$name', with these overrides:
- Skip plan mode and skip waiting for approval: treat the plan as approved the moment you have saved it to implementation-plan/$name-plan.md, then implement it fully (steps 7 and 8 included).
- Do not stop to ask the user anything.
End your reply with exactly one last line: 'RESULT: DONE' or 'RESULT: BLOCKED - <reason>'.
"@
    $o = Invoke-Claude $p1 "$name-1-build.log"
    if ($o -match 'RESULT:\s*BLOCKED') { throw "Blocked while building: $(($o -split "`n" | Select-String 'RESULT:').Line)" }

    # 2. verify, then fix + re-verify up to N rounds ---------------------------
    $passed = $false
    for ($round = 0; $round -le $MaxFixRounds; $round++) {
      $p2 = @"
$common
Follow .claude/commands/verify-spec.md for spec '$name' exactly (audit only, change no source code, write the report under test-results/).
End your reply with exactly one last line: 'VERDICT: PASS' if every requirement is implemented, tested and passing and no security/rule check FAILs, otherwise 'VERDICT: FAIL'.
"@
      $o = Invoke-Claude $p2 "$name-2-verify-$round.log"
      if ($o -match 'VERDICT:\s*PASS') { $passed = $true; break }
      if ($round -eq $MaxFixRounds) { break }

      $p3 = @"
$common
The verification of spec '$name' failed. Read the newest report folder for it in test-results/ (also test-results/LATEST.md).
Fix every failure, gap and FAIL in the SOURCE and TESTS properly. Never weaken, skip or delete a test, never add eslint-disable.
Then run the run-checks skill and make lint, tests and build pass.
End your reply with exactly one last line: 'RESULT: DONE' or 'RESULT: BLOCKED - <reason>'.
"@
      $o = Invoke-Claude $p3 "$name-3-fix-$round.log"
      if ($o -match 'RESULT:\s*BLOCKED') { throw "Blocked while fixing: $(($o -split "`n" | Select-String 'RESULT:').Line)" }
    }
    if (-not $passed) { throw "Still failing verification after $MaxFixRounds fix round(s)." }

    # 3. commit ----------------------------------------------------------------
    git add -A
    git commit -m "feat: implement $name (auto-run)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" | Out-Null
    $results += "$name - PASSED and committed"
  }
  catch {
    $results += "$name - STOPPED: $($_.Exception.Message)"
    Finish $false "Stopped at spec $name. $($_.Exception.Message)"
  }
}

Finish $true "All specs $From to $To built, verified and committed on branch $Branch."
