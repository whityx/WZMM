param(
    [string]$TargetDir = "$env:LOCALAPPDATA\wzmm\.python",
    [string]$ReqFile = ""
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

try {
    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    }

    $pyExe = Join-Path $TargetDir 'python.exe'
    if (-not (Test-Path $pyExe)) {
        Write-Host '[3D Viewer] Downloading standalone Python 3.11...'
        $zipPath = Join-Path $env:TEMP 'python_embed_311.zip'
        (New-Object System.Net.WebClient).DownloadFile('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip', $zipPath)

        Write-Host '[3D Viewer] Extracting Python runtime...'
        Expand-Archive -Path $zipPath -DestinationPath $TargetDir -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

        $pth = Get-ChildItem -Path $TargetDir -Filter '*._pth' | Select-Object -First 1
        if ($pth) {
            $c = Get-Content $pth.FullName
            $c = $c -replace '^#import site', 'import site'
            Set-Content -Path $pth.FullName -Value $c
            Add-Content -Path $pth.FullName -Value 'Lib\site-packages'
            Add-Content -Path $pth.FullName -Value 'Scripts'
            Add-Content -Path $pth.FullName -Value '.'
        }

        $getPipPath = Join-Path $env:TEMP 'get-pip.py'
        Write-Host '[3D Viewer] Installing pip...'
        (New-Object System.Net.WebClient).DownloadFile('https://bootstrap.pypa.io/get-pip.py', $getPipPath)
        & $pyExe $getPipPath --no-warn-script-location | Out-Null
        Remove-Item $getPipPath -Force -ErrorAction SilentlyContinue
    }

    if ($ReqFile -and (Test-Path $ReqFile)) {
        Write-Host '[3D Viewer] Installing required dependencies...'
        & $pyExe -m pip install --quiet -r $ReqFile pythonnet | Out-Null
        $flag = Join-Path $TargetDir '.deps_installed'
        New-Item -ItemType File -Path $flag -Force | Out-Null
    }

    Write-Host '[3D Viewer] Python environment is ready.'
    exit 0
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
