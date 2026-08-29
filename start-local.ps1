$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue

if ($nodeCommand) {
    $nodePath = $nodeCommand.Source
} else {
    $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}

if (-not (Test-Path -LiteralPath $nodePath)) {
    throw '未找到 Node.js。请安装 Node.js 22.13 或更高版本。'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) {
    throw '前端尚未构建。请先在项目目录运行 pnpm install 和 pnpm build。'
}

Set-Location $projectRoot
Write-Host '正在启动启明 ERP：http://127.0.0.1:3001' -ForegroundColor Green
& $nodePath 'server\index.js'
