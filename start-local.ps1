$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
} else {
    $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $nodePath)) {
    throw '未找到 Node.js。请安装项目目标版本 Node.js 22.23.2。'
}
$nodeVersion = (& $nodePath --version).Trim()
if ($nodeVersion -ne 'v22.23.2') {
    throw "Node.js 版本不匹配：当前 $nodeVersion，项目要求 22.23.2。"
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
    throw '前端尚未构建。请先在项目目录运行 pnpm install 和 pnpm build。'
}

Set-Location $projectRoot
Write-Host '正在启动启明 ERP：http://127.0.0.1:3001' -ForegroundColor Green
& $nodePath 'server\index.js'
