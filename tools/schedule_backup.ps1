# Registers the daily database backup (tools/db_backup.py) as a Windows
# scheduled task for the current user. No administrator rights needed.
#
#   powershell -File tools\schedule_backup.ps1
#
# Remove it again with:
#   Unregister-ScheduledTask -TaskName "KiNg DB backup"
#
# The task runs every hour and takes a backup only when the newest one is more
# than 23 hours old: one backup a day, at the first hour that finds the
# database up. A single time of day is not enough here. Task Scheduler does not
# retry a run that ends with an error, and the database is only up while
# Docker Desktop is running.
$ErrorActionPreference = "Stop"

$name = "KiNg DB backup"
$repo = Split-Path -Parent $PSScriptRoot
# The base interpreter's pythonw.exe, not .venv\Scripts\pythonw.exe: the venv's
# launcher opens a console window on every run. db_backup.py uses only the
# standard library, so it does not need the venv.
$pythonw = & "$repo\.venv\Scripts\python.exe" -c "import os, sys; print(os.path.join(sys.base_prefix, 'pythonw.exe'))"
if (-not $pythonw -or -not (Test-Path $pythonw)) { throw "pythonw.exe was not found next to the interpreter of $repo\.venv" }

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$repo\tools\db_backup.py`" backup --if-older-than 23" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Once -At "00:15" -RepetitionInterval (New-TimeSpan -Hours 1)
# The defaults skip a laptop running on battery and never make up for a run
# that was missed while the machine was off or asleep.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

$directory = [Environment]::GetEnvironmentVariable("KING_BACKUP_DIR", "User")
if (-not $directory) { $directory = "$repo\data\backups  (same disk as the database: set KING_BACKUP_DIR)" }
Write-Output "Registered '$name'."
Write-Output "  runs:        every hour, next at $((Get-ScheduledTaskInfo -TaskName $name).NextRunTime)"
Write-Output "  backups go:  $directory"
Write-Output "  check it:    Get-ScheduledTaskInfo -TaskName '$name'   (LastTaskResult 0 = a backup under 23 hours old exists)"
