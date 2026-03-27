## Setup embedded Python 3.8 for Win7-compatible packaging
## Run from project root:  powershell -ExecutionPolicy Bypass -File .\scripts\setup-python38-embed.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$targetDir = Join-Path $root "backend\python38"
$zipUrl = "https://www.python.org/ftp/python/3.8.10/python-3.8.10-embed-amd64.zip"
$zipFile = Join-Path $env:TEMP "python-3.8.10-embed-amd64.zip"
$getPipUrl = "https://bootstrap.pypa.io/pip/3.8/get-pip.py"
$getPipFile = Join-Path $env:TEMP "get-pip-38.py"
$reqFile = Join-Path $root "requirements.txt"
$reqWin7 = Join-Path $root "requirements_win7.txt"

Write-Host ""
Write-Host "=== Setup Python 3.8 Embedded (Win7) ===" -ForegroundColor Cyan

$pythonExe = Join-Path $targetDir "python.exe"

if (Test-Path $pythonExe) {
    Write-Host "python38/python.exe already exists, skip download" -ForegroundColor Yellow
} else {
    Write-Host "Downloading Python 3.8.10 embeddable package..." -ForegroundColor Green
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing

    Write-Host "Extracting to $targetDir ..." -ForegroundColor Green
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Expand-Archive -Path $zipFile -DestinationPath $targetDir -Force
    Remove-Item $zipFile -Force -ErrorAction SilentlyContinue

    ## Enable import site in ._pth file
    $pthFile = Get-ChildItem $targetDir -Filter "python*._pth" | Select-Object -First 1
    if ($pthFile) {
        $content = Get-Content $pthFile.FullName -Raw
        $content = $content -replace '#\s*import site', 'import site'
        if ($content -notmatch 'Lib\\site-packages') {
            $content = $content.TrimEnd() + "`r`nLib\site-packages`r`n"
        }
        Set-Content $pthFile.FullName -Value $content -NoNewline
        Write-Host "Patched $($pthFile.Name): enabled import site + site-packages" -ForegroundColor Green
    }

    ## Install pip
    Write-Host "Installing pip..." -ForegroundColor Green
    Invoke-WebRequest -Uri $getPipUrl -OutFile $getPipFile -UseBasicParsing
    & $pythonExe $getPipFile --no-warn-script-location
    Remove-Item $getPipFile -Force -ErrorAction SilentlyContinue
}

## Install dependencies
$reqToUse = $reqFile
if (Test-Path $reqWin7) { $reqToUse = $reqWin7 }
Write-Host "Installing dependencies from $reqToUse ..." -ForegroundColor Green
& $pythonExe -m pip install -r $reqToUse --no-warn-script-location

## Verify
Write-Host ""
Write-Host "=== Verify ===" -ForegroundColor Cyan
& $pythonExe -c "import sys; print('Python ' + sys.version)"
& $pythonExe -c "import flask; print('Flask ' + flask.__version__)"
& $pythonExe -c "import flask_cors; print('flask_cors OK')"
& $pythonExe -c "import docx; print('python-docx OK')"

Write-Host ""
Write-Host "Done! python38/python.exe is ready." -ForegroundColor Cyan
Write-Host "Next step: npm run dist:win:legacy" -ForegroundColor Yellow
