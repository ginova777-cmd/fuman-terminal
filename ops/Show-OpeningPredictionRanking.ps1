[CmdletBinding()]
param(
    [string]$BaseUrl = "https://fuman-terminal.vercel.app",
    [ValidateRange(1, 1000)]
    [int]$Top = 30,
    [ValidateRange(1, 5)]
    [int]$MinAppearances = 2,
    [string]$Token = $env:FUMAN_TERMINAL_TOKEN,
    [string]$FinMindToken = $env:FINMIND_API_TOKEN,
    [System.Management.Automation.PSCredential]$Credential,
    [string]$OutputCsv = "",
    [string]$InputDirectory = "",
    [string]$OpeningLimitOrderDirectory = "C:\fuman-runtime\data\opening-limit-order",
    [string]$OpeningReportDirectory = "C:\fuman-runtime\data\opening-report-0830",
    [string]$OpeningTPreviewPath = "",
    [switch]$Once,
    [switch]$IncludeRawJson,
    [switch]$Logout
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $Once -and -not $Logout) {
    $childParameters = @{}
    foreach ($entry in $PSBoundParameters.GetEnumerator()) {
        if ($entry.Key -ne "Once") {
            $childParameters[$entry.Key] = $entry.Value
        }
    }
    $childParameters["Once"] = $true

    while ($true) {
        Clear-Host
        $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
        $now = [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
        Write-Host ("開盤入時槽監看｜更新時間 {0}" -f $now.ToString("yyyy-MM-dd HH:mm:ss")) -ForegroundColor Cyan
        Write-Host "只在 08:20、08:30、08:40、08:45、08:50、08:55 正式時點後刷新。" -ForegroundColor DarkGray
        Write-Host "按 Ctrl+C 可隨時停止；使用 -Once 可只查詢一次。" -ForegroundColor DarkGray
        Write-Host ""

        & $PSCommandPath @childParameters
        $childExitCode = $LASTEXITCODE
        if ($null -eq $childExitCode) { $childExitCode = 0 }

        $compactDate = $now.ToString("yyyyMMdd")
        $rankedPath = Join-Path $OpeningLimitOrderDirectory "opening-limit-order-0855-ranked-watchlist-$compactDate.json"
        $rankedComplete = $false
        if (Test-Path -LiteralPath $rankedPath -PathType Leaf) {
            try {
                $rankedPayload = Get-Content -LiteralPath $rankedPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $rankedDate = ([string]($rankedPayload.trade_date ?? $rankedPayload.tradeDate)) -replace '[^0-9]', ''
                $rankedComplete = $rankedPayload.ok -eq $true -and $rankedDate.StartsWith($compactDate)
            } catch { $rankedComplete = $false }
        }

        if ($rankedComplete) {
            Write-Host ""
            Write-Host "08:55 正式開盤入排名已完成；自動監看結束。" -ForegroundColor Green
            exit $childExitCode
        }

        $refreshSlots = @("08:20:15", "08:30:15", "08:40:15", "08:45:15", "08:50:15", "08:55:15", "08:56:15") |
            ForEach-Object { $now.Date.Add([TimeSpan]::Parse($_)) }
        $nextSlot = @($refreshSlots | Where-Object { $_ -gt $now } | Select-Object -First 1)
        if ($nextSlot.Count -eq 0) {
            Write-Warning "今日正式時槽均已結束，但 08:55 正式排名仍未完成。"
            exit $(if ($childExitCode -ne 0) { $childExitCode } else { 2 })
        }

        $waitSeconds = [Math]::Max(1, [int][Math]::Ceiling(($nextSlot[0] - $now).TotalSeconds))
        Write-Host ""
        Write-Host ("等待下一個正式刷新時點：{0}" -f $nextSlot[0].ToString("HH:mm:ss")) -ForegroundColor DarkCyan
        Start-Sleep -Seconds $waitSeconds
    }
}

$AuthUrl = "https://jxnqyqnigsppqsxinlrq.supabase.co"
$AuthKey = "sb_publishable_kCocRYzO4oCBnFRQO_pfvg_JZUl0oxm"
$AuthCacheDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "FumanTerminal"
$AuthCachePath = Join-Path $AuthCacheDirectory "ranking-auth.clixml"

function Save-RefreshToken {
    param([string]$RefreshToken, [string]$Email)
    if (-not $RefreshToken) { return }
    if (-not (Test-Path -LiteralPath $AuthCacheDirectory)) {
        New-Item -ItemType Directory -Path $AuthCacheDirectory -Force | Out-Null
    }
    [pscustomobject]@{
        Email = $Email
        RefreshToken = ConvertTo-SecureString $RefreshToken -AsPlainText -Force
        SavedAt = [DateTimeOffset]::Now.ToString("o")
    } | Export-Clixml -LiteralPath $AuthCachePath -Force
}

function ConvertFrom-ProtectedString {
    param([Security.SecureString]$SecureValue)
    if ($null -eq $SecureValue) { return "" }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

function Invoke-MembershipLogin {
    param([System.Management.Automation.PSCredential]$LoginCredential)
    if ($null -eq $LoginCredential) { throw "未提供會員帳號。" }

    Write-Host "登入終端會員帳號..." -ForegroundColor Cyan
    $body = @{
        email = $LoginCredential.UserName
        password = $LoginCredential.GetNetworkCredential().Password
    } | ConvertTo-Json
    try {
        $login = Invoke-RestMethod `
            -Uri "$AuthUrl/auth/v1/token?grant_type=password" `
            -Method Post `
            -Headers @{ apikey = $AuthKey; Accept = "application/json" } `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 30
        if (-not $login.access_token) { throw "登入成功但未取得 access token" }
        Save-RefreshToken -RefreshToken ([string]$login.refresh_token) -Email $LoginCredential.UserName
        return [string]$login.access_token
    }
    catch {
        throw "終端會員登入失敗：$($_.Exception.Message)"
    }
}

function Get-TokenFromCache {
    if (-not (Test-Path -LiteralPath $AuthCachePath -PathType Leaf)) { return "" }
    try {
        $cached = Import-Clixml -LiteralPath $AuthCachePath
        $refreshToken = ConvertFrom-ProtectedString $cached.RefreshToken
        if (-not $refreshToken) { return "" }
        Write-Host "使用已儲存的登入狀態..." -ForegroundColor DarkCyan
        $body = @{ refresh_token = $refreshToken } | ConvertTo-Json
        $session = Invoke-RestMethod `
            -Uri "$AuthUrl/auth/v1/token?grant_type=refresh_token" `
            -Method Post `
            -Headers @{ apikey = $AuthKey; Accept = "application/json" } `
            -ContentType "application/json" `
            -Body $body `
            -TimeoutSec 30
        if (-not $session.access_token) { throw "更新登入狀態失敗" }
        Save-RefreshToken -RefreshToken ([string]$session.refresh_token) -Email ([string]$cached.Email)
        return [string]$session.access_token
    }
    catch {
        Write-Warning "已儲存的登入狀態失效，請重新登入一次。"
        Remove-Item -LiteralPath $AuthCachePath -Force -ErrorAction SilentlyContinue
        return ""
    }
}

if ($Logout) {
    Remove-Item -LiteralPath $AuthCachePath -Force -ErrorAction SilentlyContinue
    Write-Host "已清除終端會員登入狀態。" -ForegroundColor Green
    exit 0
}

# Viewer 預設只顯示，不自動寫入桌面；只有明確指定 -OutputCsv 才輸出檔案。

$ResolvedToken = ""
if ($Token) {
    $ResolvedToken = $Token
} elseif (-not $InputDirectory) {
    $ResolvedToken = Get-TokenFromCache
    if (-not $ResolvedToken) {
        if ($null -eq $Credential) {
            $Credential = Get-Credential -Message "首次使用：請登入終端會員帳號（之後會自動登入）"
        }
        $ResolvedToken = Invoke-MembershipLogin $Credential
    }
}

function Get-PropertyValue {
    param([object]$Object, [string[]]$Names)
    if ($null -eq $Object) { return $null }
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($null -ne $property -and $null -ne $property.Value) {
            return $property.Value
        }
    }
    return $null
}

function ConvertTo-StockCode {
    param([object]$Value)
    $text = [string]$Value
    $match = [regex]::Match($text.Trim().ToUpperInvariant(), '(?<!\d)(\d{4,6})(?!\d)')
    if ($match.Success) { return $match.Groups[1].Value }
    return ""
}

function ConvertTo-DateKey {
    param([object]$Value)
    $digits = ([string]$Value) -replace '[^0-9]', ''
    if ($digits.Length -ge 8) { return $digits.Substring(0, 8) }
    return ""
}

function Get-TaipeiNow {
    $tz = [System.TimeZoneInfo]::FindSystemTimeZoneById("Taipei Standard Time")
    return [System.TimeZoneInfo]::ConvertTimeFromUtc([DateTime]::UtcNow, $tz)
}

function Test-BeforeTaipeiSlot {
    param([string]$TradeDate, [string]$Slot)
    $now = Get-TaipeiNow
    $today = $now.ToString("yyyyMMdd")
    if ($TradeDate -ne $today) { return $false }
    return $now.TimeOfDay -lt [TimeSpan]::Parse($Slot)
}

function ConvertTo-OpeningStrategyText {
    param([object]$StrategyNumbers)
    $labels = @{
        "1" = "策略1：跌停打開＋主力成本高"
        "2" = "策略2：低點反彈＋連漲2日＋法人同買"
        "3" = "策略3：日K回測MA60有撐＋海外族群漲"
        "4" = "策略4：日K突破MA240＋海外族群漲"
        "5" = "策略5：股期轉強＋試撮跌停＋海外族群漲"
        "6" = "策略6：股期正價差／逆收斂"
        "7" = "策略7：海外族群連2日轉強＋台股對應"
        "8" = "策略8：W底頸線站穩2日＋隔日沖分點"
        "9" = "策略9：海外族群漲＋關鍵價位守2日"
        "10" = "策略10：昨日漲停＋股期正價差"
    }
    $numbers = @(([string]$StrategyNumbers) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $labels.ContainsKey($_) } | Select-Object -Unique)
    if ($numbers.Count -eq 0) { return "-" }
    return (($numbers | ForEach-Object { $labels[$_] }) -join "；")
}

function ConvertTo-ChineseDirection {
    param([object]$Value)
    $text = ([string]$Value).Trim().ToUpperInvariant()
    if ($text -in @("LONG", "多", "多方", "看多", "偏多", "明日偏多", "強勢延續多")) { return "多" }
    if ($text -in @("SHORT", "空", "空方", "看空", "偏空", "明日偏空", "高檔反轉空", "弱勢延續空")) { return "空" }
    # 預言家是二元方向欄；資料不足或不交易時留白，由原因欄說明。
    return ""
}

function ConvertTo-ChinesePreopenStatus {
    param([object]$Value)
    $text = ([string]$Value).Trim().ToUpperInvariant()
    switch ($text) {
        "CONFIRMED_LONG" { return "多方確認" }
        "LONG_CANCELLED" { return "多方取消" }
        "CONFIRMED_SHORT" { return "空方確認" }
        "SHORT_CANCELLED" { return "空方取消" }
        "NO_TRADE" { return "不交易" }
        "MISSING_PREOPEN_EVIDENCE" { return "缺少盤前證據" }
        default { return $(if ($Value) { [string]$Value } else { "盤前狀態未提供" }) }
    }
}

function ConvertTo-PredictionReasonText {
    param([object]$Value)
    $items = if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) { @($Value) } else { @($Value) }
    $labels = @{
        "STRONG_ATTACK_CONTINUATION_LONG" = "強勢延續：漲幅、收盤位置及量能條件支持明日偏多"
        "HIGH_LEVEL_REVERSAL_SHORT" = "高檔反轉：爆量創高但收不住，明日偏空"
        "WEAKNESS_CONTINUATION_SHORT" = "弱勢延續：高點降低、收盤降低且收黑，明日偏空"
        "NO_DAILY_DIRECTION" = "多空劇本條件不足，明日不交易"
        "MISSING_PREDICTION_EVIDENCE" = "明日預測證據不足"
    }
    $text = @($items | ForEach-Object {
        $item = ([string]$_).Trim()
        if (-not $item) { return }
        $key = $item.ToUpperInvariant()
        if ($labels.ContainsKey($key)) { $labels[$key] } else { $item }
    } | Where-Object { $_ } | Select-Object -Unique)
    return ($text -join "；")
}

function Get-PayloadRows {
    param([object]$Payload)

    foreach ($propertyName in @("candidates", "watchlist", "matches", "rows", "items", "results", "stocks", "data")) {
        $value = Get-PropertyValue $Payload @($propertyName)
        if ($null -eq $value) { continue }

        if ($value -is [System.Collections.IDictionary] -or $value -is [pscustomobject]) {
            $properties = @($value.PSObject.Properties)
            if ($properties.Count -gt 0 -and $properties[0].Name -notin @("code", "symbol", "stock_id", "stockId")) {
                return @($properties | ForEach-Object { $_.Value })
            }
        }

        if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
            return @($value)
        }
    }
    return @()
}

function Get-FinMindToken {
    if ($FinMindToken) { return $FinMindToken }
    if ($env:FINMIND_TOKEN) { return $env:FINMIND_TOKEN }
    $secretPath = "C:\fuman-runtime\secrets\finmind-api-token.txt"
    if (Test-Path -LiteralPath $secretPath -PathType Leaf) {
        return (Get-Content -LiteralPath $secretPath -Raw -Encoding UTF8).Trim()
    }
    return ""
}

function Get-TopNetBuyBranch {
    param([string]$Code, [string]$ApiToken)

    if (-not $ApiToken) { return $null }
    $rows = @()
    foreach ($daysBack in 0..10) {
        $queryDate = [DateTime]::Today.AddDays(-$daysBack).ToString("yyyy-MM-dd")
        $query = @{
            dataset = "TaiwanStockTradingDailyReport"
            data_id = $Code
            start_date = $queryDate
        }
        $queryString = ($query.GetEnumerator() | ForEach-Object {
            "{0}={1}" -f [uri]::EscapeDataString($_.Key), [uri]::EscapeDataString([string]$_.Value)
        }) -join "&"
        $response = Invoke-RestMethod `
            -Uri "https://api.finmindtrade.com/api/v4/data?$queryString" `
            -Headers @{ Authorization = "Bearer $ApiToken"; Accept = "application/json" } `
            -Method Get `
            -TimeoutSec 45
        $rows = @($response.data)
        if ($rows.Count -gt 0) { break }
    }
    if ($rows.Count -eq 0) { return $null }

    $latestDate = @($rows | ForEach-Object { [string](Get-PropertyValue $_ @("date", "trade_date")) } |
        Where-Object { $_ } | Sort-Object -Descending | Select-Object -First 1)[0]
    if (-not $latestDate) { return $null }

    $branches = @{}
    foreach ($row in @($rows | Where-Object { [string](Get-PropertyValue $_ @("date", "trade_date")) -eq $latestDate })) {
        $branchId = [string](Get-PropertyValue $row @("securities_trader_id", "trader_id", "broker_id"))
        $branchName = [string](Get-PropertyValue $row @("securities_trader", "trader", "branch_name", "name"))
        $key = if ($branchId) { $branchId } else { $branchName }
        if (-not $key) { continue }
        $buy = 0.0
        $sell = 0.0
        [void][double]::TryParse(([string](Get-PropertyValue $row @("buy", "Buy", "buy_volume", "buy_amount")) -replace '[,%+]', ''), [ref]$buy)
        [void][double]::TryParse(([string](Get-PropertyValue $row @("sell", "Sell", "sell_volume", "sell_amount")) -replace '[,%+]', ''), [ref]$sell)
        if (-not $branches.ContainsKey($key)) {
            $branches[$key] = [ordered]@{ Id = $branchId; Name = $branchName; Buy = 0.0; Sell = 0.0; NetCostAmount = 0.0; NetCostQuantity = 0.0 }
        }
        $branches[$key].Buy += $buy
        $branches[$key].Sell += $sell
        $price = 0.0
        [void][double]::TryParse(([string](Get-PropertyValue $row @("price", "Price", "trade_price")) -replace '[,%+]', ''), [ref]$price)
        $netAtPrice = $buy - $sell
        if ($netAtPrice -gt 0 -and $price -gt 0) {
            $branches[$key].NetCostAmount += $netAtPrice * $price
            $branches[$key].NetCostQuantity += $netAtPrice
        }
        if (-not $branches[$key].Name -and $branchName) { $branches[$key].Name = $branchName }
    }

    $leader = @($branches.Values | ForEach-Object {
        [pscustomobject]@{
            BrokerBranch = if ($_.Name) { $_.Name } else { $_.Id }
            BrokerBranchId = $_.Id
            BrokerNetBuy = [double]$_.Buy - [double]$_.Sell
            BrokerBuy = [double]$_.Buy
            BrokerSell = [double]$_.Sell
            BrokerCost = if ([double]$_.NetCostQuantity -gt 0) { [double]$_.NetCostAmount / [double]$_.NetCostQuantity } else { $null }
            BrokerTradeDate = $latestDate
        }
    } | Where-Object { $_.BrokerNetBuy -gt 0 } |
        Sort-Object @{ Expression = "BrokerNetBuy"; Descending = $true } |
        Select-Object -First 1)
    if ($leader.Count -eq 0) { return $null }
    return $leader[0]
}

function Read-SourcePayload {
    param([string]$Key, [string]$Endpoint)

    if ($InputDirectory) {
        $path = Join-Path $InputDirectory "$Key.json"
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "找不到離線資料檔：$path"
        }
        return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
    }

    $headers = @{ Accept = "application/json" }
    if ($ResolvedToken) { $headers.Authorization = "Bearer $ResolvedToken" }
    $uri = "{0}{1}{2}" -f $BaseUrl.TrimEnd('/'), $Endpoint, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    try {
        return Invoke-RestMethod -Uri $uri -Headers $headers -Method Get -TimeoutSec 45
    }
    catch {
        $status = $_.Exception.Response.StatusCode.value__
        if ($status -eq 401 -or $status -eq 403) {
            throw "$Key API 會員授權失效（HTTP $status）。請執行本腳本 -Logout 後重新執行一次。"
        }
        throw "讀取 $Key 失敗：$($_.Exception.Message)"
    }
}

$sourceDefinitions = @(
    [pscustomobject]@{ Key = "strategy3"; Label = "終端3"; Endpoint = "/api/strategy3-latest?canvas=1&compact=1&limit=2000&live=1&ts=" },
    [pscustomobject]@{ Key = "strategy4"; Label = "終端4"; Endpoint = "/api/strategy4-latest?canvas=1&compact=1&limit=2000&live=1&ts=" },
    [pscustomobject]@{ Key = "strategy5"; Label = "終端5"; Endpoint = "/api/strategy5-latest?canvas=1&compact=1&limit=2000&live=1&ts=" },
    [pscustomobject]@{ Key = "institution"; Label = "買賣超"; Endpoint = "/api/institution-latest?canvas=1&compact=1&limit=2000&live=1&ts=" }
)

$stocks = @{}
$sourceSummary = [System.Collections.Generic.List[object]]::new()
$rawPayloads = [ordered]@{}

foreach ($source in $sourceDefinitions) {
    Write-Host ("讀取 {0}..." -f $source.Label) -ForegroundColor Cyan
    $payload = Read-SourcePayload -Key $source.Key -Endpoint $source.Endpoint
    $rawPayloads[$source.Key] = $payload
    $rows = @(Get-PayloadRows $payload)
    $seenInSource = @{}

    foreach ($row in $rows) {
        $code = ConvertTo-StockCode (Get-PropertyValue $row @("code", "symbol", "stock_id", "stockId", "ticker"))
        if (-not $code -or $seenInSource.ContainsKey($code)) { continue }
        $seenInSource[$code] = $true

        if (-not $stocks.ContainsKey($code)) {
            $stocks[$code] = [ordered]@{
                Code = $code
                Name = ""
                Sources = [ordered]@{}
                InstitutionNet = $null
                InstitutionDirection = ""
                Opening0855 = ""
                OpeningRank = $null
                OpeningStrategyCount = 0
                OpeningStrategies = ""
                OpeningTStrategies = ""
                FuturesGain = $null
                TrialPriceStatus = ""
                PreferredBroker = ""
                Direction = ""
                DirectionReason = ""
                PreopenConfirmation = "盤前狀態未提供"
                CancelReasons = ""
            }
        }

        $stock = $stocks[$code]
        $name = [string](Get-PropertyValue $row @("name", "title", "stock_name", "stockName"))
        if (-not $stock.Name -and $name) { $stock.Name = $name.Trim() }
        $stock.Sources[$source.Key] = $true

        if ($source.Key -eq "institution") {
            $netValue = Get-PropertyValue $row @("institutionTotalNet", "institution_total_net", "totalNet", "total_net", "total")
            $net = 0.0
            if ([double]::TryParse(([string]$netValue -replace '[,%+]', ''), [ref]$net)) {
                $stock.InstitutionNet = $net
                $stock.InstitutionDirection = if ($net -gt 0) { "買超" } elseif ($net -lt 0) { "賣超" } else { "持平" }
            }
        }
    }

    $sourceSummary.Add([pscustomobject]@{
        Source = $source.Label
        Rows = $rows.Count
        UniqueStocks = $seenInSource.Count
        TradeDate = [string](Get-PropertyValue $payload @("tradeDate", "usedDate", "sourceDate", "scanDate", "dataDate"))
        RunId = [string](Get-PropertyValue $payload @("runId", "run_id", "latestRunId"))
    })
}

$sourceTradeDate = @($sourceSummary | ForEach-Object { ConvertTo-DateKey $_.TradeDate } |
    Where-Object { $_ } | Sort-Object -Descending | Select-Object -First 1)[0]
$taipeiToday = (Get-TaipeiNow).ToString("yyyyMMdd")
$today0820Path = Join-Path $OpeningReportDirectory "opening-report-0820-preflight-receipt-$taipeiToday.json"
$today0820 = if (Test-Path -LiteralPath $today0820Path -PathType Leaf) {
    try { Get-Content -LiteralPath $today0820Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
} else { $null }
$today0820Date = ConvertTo-DateKey (Get-PropertyValue $today0820 @("date", "trade_date"))
$today0820Valid = $today0820 -and $today0820.ok -eq $true -and $today0820Date -eq $taipeiToday
$targetTradeDate = if ($today0820Valid) { $taipeiToday } elseif ($sourceTradeDate) { $sourceTradeDate } else { $taipeiToday }
$openingStatus = "MISSING"
$openingRunId = ""
$openingRows = @()
$openingStaticByCode = @{}
$openingStaticDate = ""
$opening0820Path = Join-Path $OpeningReportDirectory "opening-report-0820-preflight-receipt-$targetTradeDate.json"
$opening0820 = if (Test-Path -LiteralPath $opening0820Path -PathType Leaf) {
    try { Get-Content -LiteralPath $opening0820Path -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $null }
} else { $null }
$opening0820Date = ConvertTo-DateKey (Get-PropertyValue $opening0820 @("date", "trade_date"))
$opening0820Ok = $opening0820 -and $opening0820.ok -eq $true -and
    $opening0820Date -eq $targetTradeDate -and [int]$opening0820.industry_count -eq 15 -and
    $opening0820.frozen_market_snapshot_ok -eq $true -and $opening0820.overseas_detector_ok -eq $true
$staticPayload = $null

if ($targetTradeDate -and (Test-Path -LiteralPath $OpeningLimitOrderDirectory -PathType Container)) {
    $staticPath = Join-Path $OpeningLimitOrderDirectory "opening-limit-order-0850-static-prefilter-$targetTradeDate.json"
    if (-not (Test-Path -LiteralPath $staticPath -PathType Leaf) -and $OpeningTPreviewPath -and (Test-Path -LiteralPath $OpeningTPreviewPath -PathType Leaf)) {
        $previewPayload = Get-Content -LiteralPath $OpeningTPreviewPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $previewSignalDate = ConvertTo-DateKey @($previewPayload.rows | Select-Object -First 1).signal_date
        if ($previewPayload.ok -eq $true -and $previewSignalDate -eq $targetTradeDate) {
            $staticPath = $OpeningTPreviewPath
        }
    }
    if (Test-Path -LiteralPath $staticPath -PathType Leaf) {
        $staticPayload = Get-Content -LiteralPath $staticPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $openingStaticDate = ConvertTo-DateKey @($staticPayload.rows | Select-Object -First 1).signal_date
        if (-not $openingStaticDate) { $openingStaticDate = ConvertTo-DateKey (Get-PropertyValue $staticPayload @("trade_date", "tradeDate")) }
        if ($openingStaticDate -eq $targetTradeDate) {
            foreach ($row in @($staticPayload.rows)) {
                $code = ConvertTo-StockCode (Get-PropertyValue $row @("symbol", "code"))
                if ($code) { $openingStaticByCode[$code] = $row }
            }
        }
    }

    $rankedPath = Join-Path $OpeningLimitOrderDirectory "opening-limit-order-0855-ranked-watchlist-$targetTradeDate.json"
    if (Test-Path -LiteralPath $rankedPath -PathType Leaf) {
        $openingPayload = Get-Content -LiteralPath $rankedPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $openingRunId = [string](Get-PropertyValue $openingPayload @("run_id", "runId"))
        $sameDate = (ConvertTo-DateKey (Get-PropertyValue $openingPayload @("trade_date", "tradeDate"))) -eq $targetTradeDate
        $guard = Get-PropertyValue $openingPayload @("action_guard")
        $readOnlyGuard = $guard -and
            (Get-PropertyValue $guard @("creates_order")) -eq $false -and
            (Get-PropertyValue $guard @("creates_formal_candidate")) -eq $false -and
            (Get-PropertyValue $guard @("publish_allowed")) -eq $false
        if ($sameDate -and $readOnlyGuard -and (Get-PropertyValue $openingPayload @("ok")) -eq $true) {
            $openingRows = @((Get-PayloadRows $openingPayload) + @(Get-PropertyValue $openingPayload @("predictions")))
            $openingStatus = "OK"
        } elseif ($sameDate) {
            $openingStatus = "DEGRADED"
        }
    }
    if ($openingStatus -ne "OK") {
        $summaryPath = Join-Path $OpeningLimitOrderDirectory "opening-limit-order-0855-summary-$targetTradeDate.json"
        if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
            $summaryPayload = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $summaryGuard = Get-PropertyValue $summaryPayload @("action_guard")
            $summaryReadOnly = $summaryGuard -and (Get-PropertyValue $summaryGuard @("creates_order")) -eq $false -and (Get-PropertyValue $summaryGuard @("creates_formal_candidate")) -eq $false -and (Get-PropertyValue $summaryGuard @("publish_allowed")) -eq $false
            if ((Get-PropertyValue $summaryPayload @("ok")) -eq $true -and $summaryReadOnly -and (ConvertTo-DateKey (Get-PropertyValue $summaryPayload @("trade_date", "tradeDate"))) -eq $targetTradeDate) {
                $openingPayload = $summaryPayload
                $openingRunId = [string](Get-PropertyValue $summaryPayload @("run_id", "runId"))
                $openingRows = @(@(Get-PropertyValue $summaryPayload @("candidates")) + @(Get-PropertyValue $summaryPayload @("predictions")))
                $openingStatus = "OK"
            }
        }
    }
}

# Canonical 08:50 prediction is the only direction authority.
$predictionFreezePath = Join-Path $OpeningLimitOrderDirectory "opening-limit-order-0850-predictions-$targetTradeDate.json"
$predictionVerifyPath = Join-Path $OpeningLimitOrderDirectory "opening-limit-order-0850-verifier-$targetTradeDate.json"
$predictionReadback = $null
$predictionCheck = $null
$predictionBlocker = "WAITING_SLOT"
if (-not (Test-BeforeTaipeiSlot -TradeDate $targetTradeDate -Slot "08:50")) { $predictionBlocker = "MISSING_0850_FREEZE_OR_VERIFIER" }
try {
  if ((Test-Path -LiteralPath $predictionFreezePath) -and (Test-Path -LiteralPath $predictionVerifyPath)) {
    $predictionReadback = Get-Content -LiteralPath $predictionFreezePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $predictionCheck = Get-Content -LiteralPath $predictionVerifyPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $predictionHash = (Get-FileHash -LiteralPath $predictionFreezePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $verified = $predictionCheck.ok -eq $true -and $predictionReadback.ok -eq $true -and
      $predictionCheck.contract -eq "opening_prediction_verifier_v2" -and
      @($predictionCheck.failed_checks).Count -eq 0 -and $null -eq $predictionCheck.first_blocker -and
      $predictionCheck.canonical_sha256 -eq $predictionHash -and
      $predictionCheck.run_id -eq $predictionReadback.run_id -and
      (ConvertTo-DateKey $predictionCheck.trade_date) -eq $targetTradeDate -and
      (ConvertTo-DateKey $predictionReadback.trade_date) -eq $targetTradeDate -and $targetTradeDate -eq $taipeiToday
    if ($verified) {
      $openingRows = @($predictionReadback.predictions)
      $openingRunId = [string]$predictionReadback.run_id
      $openingStatus = "OK"
      $predictionBlocker = ""
    } else { $predictionBlocker = "FAILED_0850_CANONICAL_VERIFICATION" }
  } elseif (Test-Path -LiteralPath $predictionFreezePath) {
    $predictionReadback = Get-Content -LiteralPath $predictionFreezePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $predictionBlocker = [string](Get-PropertyValue $predictionReadback @("first_blocker"))
    if (-not $predictionBlocker) { $predictionBlocker = "MISSING_0850_VERIFIER" }
  }
} catch { $predictionBlocker = "INVALID_0850_FREEZE_OR_VERIFIER" }
if ($predictionBlocker) { $openingRows = @(); $openingStatus = $predictionBlocker }

foreach ($row in $openingRows) {
    $code = ConvertTo-StockCode (Get-PropertyValue $row @("symbol", "code", "stock_id"))
    if (-not $code) { continue }
    if (-not $stocks.ContainsKey($code)) {
        $stocks[$code] = [ordered]@{
            Code = $code; Name = ""; Sources = [ordered]@{}; InstitutionNet = $null; InstitutionDirection = ""
            Opening0855 = ""; OpeningRank = $null; OpeningStrategyCount = 0; OpeningStrategies = ""
            OpeningTStrategies = ""
            FuturesGain = $null; TrialPriceStatus = ""; PreferredBroker = ""
            Direction = ""; DirectionReason = ""; PreopenConfirmation = "盤前狀態未提供"; CancelReasons = ""
        }
    }
    $stock = $stocks[$code]
    $rowOpeningRank = Get-PropertyValue $row @("rank", "opening_rank", "final_rank")
    $isOpeningCandidate = (Get-PropertyValue $row @("prediction")) -in @("多", "空")
    if ($isOpeningCandidate) {
        $stock.Sources["opening"] = $true; $stock.Opening0855 = "Y"; $stock.OpeningRank = $rowOpeningRank
        $strategyNumbers = @(Get-PropertyValue $row @("matched_strategy_numbers", "strategy_numbers", "strategies"))
        $stock.OpeningStrategies = ($strategyNumbers -join ",")
        $stock.OpeningStrategyCount = if ($strategyNumbers.Count) { $strategyNumbers.Count } else { [int](Get-PropertyValue $row @("strategy_count", "matched_strategy_count")) }
        $stock.FuturesGain = Get-PropertyValue $row @("futopt_gain_pct", "futures_gain_pct", "futopt_max_change_pct_0845_0859")
        $stock.TrialPriceStatus = [string](Get-PropertyValue $row @("trial_price_status", "trial_status"))
        $preferred = Get-PropertyValue $row @("preferred_broker_top_net_buy", "preferred_broker")
        $stock.PreferredBroker = if ($preferred -eq $true) { "Y" } else { "" }
    }
    # 「預言家」只讀已驗證且雜湊一致的當日08:50凍結欄位。
    $stock.Direction = ConvertTo-ChineseDirection (Get-PropertyValue $row @("prediction"))
    $stock.DirectionReason = ConvertTo-PredictionReasonText (Get-PropertyValue $row @("tomorrow_prediction_reasons", "tomorrow_prediction_reason", "tomorrow_scenario_reasons", "next_trading_day_reason", "next_day_reason"))
    $stock.PreopenConfirmation = ConvertTo-ChinesePreopenStatus (Get-PropertyValue $row @("preopen_confirmation_label", "preopen_confirmation", "confirmation_status"))
    $stock.CancelReasons = (@(Get-PropertyValue $row @("preopen_cancel_reasons", "cancel_reasons", "hard_reject_reasons")) -join "；")
}

foreach ($code in @($stocks.Keys)) {
    if ($predictionBlocker) { $stocks[$code].Direction = ""; $stocks[$code].DirectionReason = $predictionBlocker }
    if (-not $openingStaticByCode.ContainsKey($code)) { continue }
    $stock = $stocks[$code]
    $row = $openingStaticByCode[$code]
    $staticStrategies = @(Get-PropertyValue $row @("static_matched_strategy_numbers"))
    $tStrategies = @($staticStrategies | Where-Object { $_ -in @(1, 2, 8, "1", "2", "8") } | Sort-Object -Unique)
    if ($tStrategies.Count) {
        $stock.OpeningTStrategies = ($tStrategies -join ",")
        if ($stock.OpeningStrategyCount -lt $tStrategies.Count) { $stock.OpeningStrategyCount = $tStrategies.Count }
    }
    $evidence = Get-PropertyValue $row @("evidence")
    if ($evidence) {
        if ($null -eq $stock.FuturesGain) { $stock.FuturesGain = Get-PropertyValue $evidence @("futopt_max_change_pct_0845_0859", "futures_gain_pct") }
        if (-not $stock.TrialPriceStatus) { $stock.TrialPriceStatus = [string](Get-PropertyValue $evidence @("trial_price_status", "trial_status")) }
        if ((Get-PropertyValue $evidence @("preferred_broker_top_net_buy")) -eq $true) { $stock.PreferredBroker = "Y" }
    }
}

$sourceSummary.Add([pscustomobject]@{
    Source = "開盤入"
    Rows = $openingRows.Count
    UniqueStocks = @($openingRows | ForEach-Object { ConvertTo-StockCode (Get-PropertyValue $_ @("symbol", "code")) } | Where-Object { $_ } | Sort-Object -Unique).Count
    TradeDate = $targetTradeDate
    RunId = if ($openingRunId) { $openingRunId } else { $openingStatus }
})

$openingStageSummary = [System.Collections.Generic.List[object]]::new()
$openingStageSummary.Add([pscustomobject]@{
    時間 = "T-1收盤後"
    階段 = "預言家產生明日多／空初判；確認策略1、2、8；預判策略3、4、9、10的本地型態"
    狀態 = if ($staticPayload -and $staticPayload.ok -eq $true) { "OK({0})" -f @($staticPayload.rows).Count }
        else { "MISSING" }
})
$openingStageSummary.Add([pscustomobject]@{
    時間 = "T日 08:20"
    階段 = "補入海外產業證據；確認策略3、4、7、9"
    狀態 = if ($opening0820Ok) { "OK" }
        elseif (Test-BeforeTaipeiSlot -TradeDate $targetTradeDate -Slot "08:20") { "WAITING_SLOT" }
        elseif ($opening0820) { "DEGRADED" }
        else { "MISSING" }
})
foreach ($stage in @(
    @{ Time = "T日 08:40"; Slot = "08:40"; Label = "建立多空預觀察池；彙整T-1與08:20證據，建立方向型預觀察池"; File = "opening-limit-order-0840-pre-candidates-$targetTradeDate.json" },
    @{ Time = "T日 08:45"; Slot = "08:45"; Label = "第一次天然股期／試撮確認"; File = "opening-limit-order-0845-futopt-readback-$targetTradeDate.json"; SlotKey = "0845" },
    @{ Time = "T日 08:50"; Slot = "08:50"; Label = "第二次確認，立即凍結並發布最終多／空"; File = "opening-limit-order-0850-predictions-$targetTradeDate.json" }
)) {
    $stagePath = Join-Path $OpeningLimitOrderDirectory $stage.File
    $stagePayload = if (Test-Path -LiteralPath $stagePath -PathType Leaf) { Get-Content -LiteralPath $stagePath -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
    $stageStatus = if (-not $stagePayload) {
        if (Test-BeforeTaipeiSlot -TradeDate $targetTradeDate -Slot $stage.Slot) { "WAITING_SLOT" } else { "MISSING" }
    } elseif ($stage.File -like "opening-limit-order-0845-futopt-readback-*") {
        $slotReceipts = Get-PropertyValue $stagePayload @("slot_receipts")
        $slotItem = Get-PropertyValue $slotReceipts @($stage.SlotKey)
        $slotOk = $slotItem -and (Get-PropertyValue $slotItem @("readable")) -eq $true -and ((Get-PropertyValue $slotItem @("ok")) -eq $true -or (Get-PropertyValue $slotItem @("usable")) -eq $true)
        if ($slotOk) { "OK" } else { "DEGRADED" }
    } elseif ($stagePayload.ok -eq $true) {
        "OK"
    } else {
        "DEGRADED"
    }
    $openingStageSummary.Add([pscustomobject]@{
        時間 = $stage.Time
        階段 = $stage.Label
        狀態 = $stageStatus
    })
}
$openingStageSummary.Add([pscustomobject]@{
    時間 = "T日 08:55"
    階段 = "只監看08:50凍結結果並整理排名；不得修改預言"
    狀態 = if ($openingStatus -eq "OK") { "OK" }
        elseif (Test-BeforeTaipeiSlot -TradeDate $targetTradeDate -Slot "08:55") { "WAITING_SLOT" }
        else { $openingStatus }
})
$openingStageSummary.Add([pscustomobject]@{
    時間 = "T日 09:00"
    階段 = "依08:50凍結預言執行"
    狀態 = "使用者執行"
})
$openingStageSummary.Add([pscustomobject]@{
    時間 = "T日 09:00～09:05"
    階段 = "結算勝／敗／平手／未成交"
    狀態 = "使用者結算"
})

$ranked = @($stocks.Values | ForEach-Object {
    $sourceKeys = @($_.Sources.Keys)
    [pscustomobject]@{
        Rank = 0
        Code = $_.Code
        Name = $_.Name
        Appearances = $sourceKeys.Count
        Terminal3 = if ($_.Sources.Contains("strategy3")) { "Y" } else { "" }
        Terminal4 = if ($_.Sources.Contains("strategy4")) { "Y" } else { "" }
        Terminal5 = if ($_.Sources.Contains("strategy5")) { "Y" } else { "" }
        Institution = if ($_.Sources.Contains("institution")) { "Y" } else { "" }
        Opening0855 = $_.Opening0855
        OpeningRank = $_.OpeningRank
        OpeningStrategyCount = $_.OpeningStrategyCount
        OpeningStrategies = $_.OpeningStrategies
        OpeningTStrategies = $_.OpeningTStrategies
        FuturesGain = $_.FuturesGain
        TrialPriceStatus = $_.TrialPriceStatus
        PreferredBroker = $_.PreferredBroker
        Direction = $_.Direction
        DirectionReason = $_.DirectionReason
        PreopenConfirmation = $_.PreopenConfirmation
        CancelReasons = $_.CancelReasons
        InstitutionDirection = $_.InstitutionDirection
        InstitutionNet = $_.InstitutionNet
        SourceList = (@($sourceDefinitions | Where-Object { $sourceKeys -contains $_.Key } | ForEach-Object { $_.Label }) + $(if ($sourceKeys -contains "opening") { "開盤入" } else { @() }) -join ", ")
    }
} | Where-Object { $_.Opening0855 -eq "Y" -or $_.Appearances -ge $MinAppearances } |
    Sort-Object @{ Expression = { if ($_.Opening0855 -eq "Y") { 1 } else { 0 } }; Descending = $true },
                @{ Expression = { if ($null -eq $_.OpeningRank) { [int]::MaxValue } else { [int]$_.OpeningRank } }; Descending = $false },
                @{ Expression = "Appearances"; Descending = $true },
                @{ Expression = "OpeningStrategyCount"; Descending = $true },
                @{ Expression = { if ($null -eq $_.InstitutionNet) { [double]::NegativeInfinity } else { [math]::Abs([double]$_.InstitutionNet) } }; Descending = $true },
                @{ Expression = "Code"; Descending = $false } |
    Select-Object -First $Top)

for ($index = 0; $index -lt $ranked.Count; $index++) { $ranked[$index].Rank = $index + 1 }

$resolvedFinMindToken = Get-FinMindToken
if (-not $InputDirectory -and $resolvedFinMindToken) {
    Write-Host "讀取 FinMind 券商分點買賣超..." -ForegroundColor Cyan
    foreach ($stock in $ranked) {
        try {
            $branch = Get-TopNetBuyBranch -Code $stock.Code -ApiToken $resolvedFinMindToken
            $stock | Add-Member -NotePropertyName TopBuyBranch -NotePropertyValue $(if ($branch) { $branch.BrokerBranch } else { "無正買超分點" })
            $stock | Add-Member -NotePropertyName TopBuyBranchNet -NotePropertyValue $(if ($branch) { $branch.BrokerNetBuy } else { $null })
            $stock | Add-Member -NotePropertyName TopBuyBranchCost -NotePropertyValue $(if ($branch) { $branch.BrokerCost } else { $null })
            $stock | Add-Member -NotePropertyName BranchTradeDate -NotePropertyValue $(if ($branch) { $branch.BrokerTradeDate } else { "" })
        }
        catch {
            Write-Warning ("{0} FinMind 分點讀取失敗：{1}" -f $stock.Code, $_.Exception.Message)
            $stock | Add-Member -NotePropertyName TopBuyBranch -NotePropertyValue "資料不足"
            $stock | Add-Member -NotePropertyName TopBuyBranchNet -NotePropertyValue $null
            $stock | Add-Member -NotePropertyName TopBuyBranchCost -NotePropertyValue $null
            $stock | Add-Member -NotePropertyName BranchTradeDate -NotePropertyValue ""
        }
    }
} else {
    foreach ($stock in $ranked) {
        $stock | Add-Member -NotePropertyName TopBuyBranch -NotePropertyValue "未設定 FinMind Token"
        $stock | Add-Member -NotePropertyName TopBuyBranchNet -NotePropertyValue $null
        $stock | Add-Member -NotePropertyName TopBuyBranchCost -NotePropertyValue $null
        $stock | Add-Member -NotePropertyName BranchTradeDate -NotePropertyValue ""
    }
}

Write-Host ""
Write-Host "各來源資料摘要" -ForegroundColor Yellow
$sourceSummary | Format-Table -AutoSize | Out-Host

Write-Host "開盤入／預言家 T-1／T 偵測進度" -ForegroundColor Yellow
if ($predictionBlocker) { Write-Warning ("預言家未發布：{0}" -f $predictionBlocker) }
$openingStageSummary | Format-Table -AutoSize | Out-Host

Write-Host ("共同出現排名（至少 {0} 個來源，前 {1} 名）" -f $MinAppearances, $Top) -ForegroundColor Yellow
if ($ranked.Count -eq 0) {
    Write-Warning "沒有股票符合條件。可改用 -MinAppearances 1。"
} else {
    Write-Host ("開盤入 08:55 狀態：{0}（交易日 {1}）" -f $openingStatus, $targetTradeDate) -ForegroundColor $(if ($openingStatus -eq "OK") { "Green" } else { "Yellow" })
    $ranked | Select-Object `
        @{ Name = "排名"; Expression = { $_.Rank } },
        @{ Name = "代號"; Expression = { $_.Code } },
        @{ Name = "名稱"; Expression = { $_.Name } },
        @{ Name = "出現數"; Expression = { $_.Appearances } },
        @{ Name = "終端3"; Expression = { $_.Terminal3 } },
        @{ Name = "終端4"; Expression = { $_.Terminal4 } },
        @{ Name = "終端5"; Expression = { $_.Terminal5 } },
        @{ Name = "買賣超"; Expression = { $_.Institution } },
        @{ Name = "買超分點"; Expression = {
            if ($null -ne $_.TopBuyBranchCost -and [double]$_.TopBuyBranchCost -gt 0) {
                "{0}｜成本 {1:N2}" -f $_.TopBuyBranch, [double]$_.TopBuyBranchCost
            } else { $_.TopBuyBranch }
        } },
        @{ Name = "開盤入策略"; Expression = {
            if ($_.Opening0855 -eq "Y" -and $_.OpeningStrategies) {
                ConvertTo-OpeningStrategyText $_.OpeningStrategies
            }
            elseif ($_.OpeningTStrategies) {
                ConvertTo-OpeningStrategyText $_.OpeningTStrategies
            }
            elseif (-not $openingStaticDate) { "T-1底稿缺失" }
            else { "-" }
        } },
        @{ Name = "預言家"; Expression = { $_.Direction } },
        @{ Name = "原因"; Expression = {
            if ($_.DirectionReason) { $_.DirectionReason }
            elseif ($_.CancelReasons) { $_.CancelReasons }
            elseif (-not $_.Direction) { "等待08:50有效凍結結果，或未列入本次預言" }
            else { "-" }
        } } |
        Format-Table -AutoSize | Out-Host
}

if ($OutputCsv) {
    $csvPath = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputCsv)
    $parent = Split-Path -Parent $csvPath
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $ranked | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding utf8BOM
    Write-Host "CSV 已輸出：$csvPath" -ForegroundColor Green
}

if ($IncludeRawJson) {
    $rawPath = if ($OutputCsv) { [IO.Path]::ChangeExtension($csvPath, ".raw.json") } else { Join-Path $PWD "terminal-345-institution.raw.json" }
    $rawPayloads | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $rawPath -Encoding utf8
    Write-Host "原始 JSON 已輸出：$rawPath" -ForegroundColor Green
}

# Keep structured objects available to pipelines.
Write-Output $ranked
