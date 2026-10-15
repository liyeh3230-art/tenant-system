import fs from 'fs';
import { execSync } from 'child_process';

const psCode = `
Add-Type -AssemblyName System.Drawing

function Get-RoundedPath {
    param(
        [System.Drawing.RectangleF]$Rect,
        [float]$Radius
    )
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $d = $Radius * 2
    if ($d -gt $Rect.Width) { $d = $Rect.Width }
    if ($d -gt $Rect.Height) { $d = $Rect.Height }
    $path.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
    $path.AddArc($Rect.Right - $d, $Rect.Y, $d, $d, 270, 90)
    $path.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($Rect.X, $Rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Generate-ModernRichMenu {
    param(
        [string]$Path,
        [string]$Theme, # "tenant" or "landlord"
        [array]$Items
    )

    $width = 2500
    $height = 1686
    $bmp = [System.Drawing.Bitmap]::new($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    # Canvas Background Gradients
    $canvasRect = [System.Drawing.RectangleF]::new(0, 0, $width, $height)
    if ($Theme -eq "landlord") {
        $cTop = [System.Drawing.ColorTranslator]::FromHtml("#070B14") # Deep obsidian
        $cBottom = [System.Drawing.ColorTranslator]::FromHtml("#0F172A") # Slate 900
    } else {
        $cTop = [System.Drawing.ColorTranslator]::FromHtml("#021D15") # Deep dark pine
        $cBottom = [System.Drawing.ColorTranslator]::FromHtml("#064E3B") # Emerald 900
    }
    $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($canvasRect, $cTop, $cBottom, 45)
    $g.FillRectangle($bgBrush, 0, 0, $width, $height)
    $bgBrush.Dispose()

    # Fonts
    $fontFamily = "Microsoft JhengHei"
    $fontTitle = [System.Drawing.Font]::new($fontFamily, 50, [System.Drawing.FontStyle]::Bold)
    $fontIcon = [System.Drawing.Font]::new("Segoe UI Emoji", 56, [System.Drawing.FontStyle]::Regular)
    $fontTag = [System.Drawing.Font]::new($fontFamily, 22, [System.Drawing.FontStyle]::Bold)
    $fontDesc = [System.Drawing.Font]::new($fontFamily, 27, [System.Drawing.FontStyle]::Regular)
    $fontBtn = [System.Drawing.Font]::new($fontFamily, 25, [System.Drawing.FontStyle]::Bold)

    $cellW = 833
    $cellH = 843
    $padding = 20

    for ($i = 0; $i -lt 6; $i++) {
        $col = $i % 3
        $row = [Math]::Floor($i / 3)
        $x = $col * $cellW
        $y = $row * $cellH
        $w = if ($col -eq 2) { 2500 - $x } else { $cellW }
        $h = $cellH

        $item = $Items[$i]

        $rx = $x + $padding
        $ry = $y + $padding
        $rw = $w - ($padding * 2)
        $rh = $h - ($padding * 2)
        $cardRect = [System.Drawing.RectangleF]::new($rx, $ry, $rw, $rh)

        # Card Colors
        $cCardTop = [System.Drawing.ColorTranslator]::FromHtml($item.CardBgTop)
        $cCardBot = [System.Drawing.ColorTranslator]::FromHtml($item.CardBgBot)
        $cBorder = [System.Drawing.ColorTranslator]::FromHtml($item.BorderColor)
        $cAccent = [System.Drawing.ColorTranslator]::FromHtml($item.AccentColor)

        # 1. Draw Card with Rounded Corners
        $cardPath = Get-RoundedPath -Rect $cardRect -Radius 36
        $cardBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($cardRect, $cCardTop, $cCardBot, 90)
        $g.FillPath($cardBrush, $cardPath)
        $cardBrush.Dispose()

        # Border Stroke
        $penBorder = [System.Drawing.Pen]::new($cBorder, 4)
        $g.DrawPath($penBorder, $cardPath)
        $penBorder.Dispose()

        # Top Accent Highlight Line (slight inset)
        $topLinePen = [System.Drawing.Pen]::new($cAccent, 6)
        $topLinePath = [System.Drawing.Drawing2D.GraphicsPath]::new()
        $topLinePath.AddArc($rx + 15, $ry + 2, 72, 72, 180, 90)
        $topLinePath.AddLine($rx + 50, $ry + 2, $rx + $rw - 50, $ry + 2)
        $topLinePath.AddArc($rx + $rw - 87, $ry + 2, 72, 72, 270, 90)
        $g.DrawPath($topLinePen, $topLinePath)
        $topLinePen.Dispose()
        $topLinePath.Dispose()
        $cardPath.Dispose()

        # String Formatters
        $sf = [System.Drawing.StringFormat]::new()
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

        # 2. Draw Icon Container (Rounded square)
        $iconBoxSize = 130
        $iconBoxX = $rx + (($rw - $iconBoxSize) / 2)
        $iconBoxY = $ry + 55
        $iconBoxRect = [System.Drawing.RectangleF]::new($iconBoxX, $iconBoxY, $iconBoxSize, $iconBoxSize)
        $iconPath = Get-RoundedPath -Rect $iconBoxRect -Radius 30
        $cIconBgTop = [System.Drawing.ColorTranslator]::FromHtml($item.IconBgTop)
        $cIconBgBot = [System.Drawing.ColorTranslator]::FromHtml($item.IconBgBot)
        $iconBgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($iconBoxRect, $cIconBgTop, $cIconBgBot, 90)
        $g.FillPath($iconBgBrush, $iconPath)
        $iconBgBrush.Dispose()

        $penIconBorder = [System.Drawing.Pen]::new($cAccent, 2.5)
        $g.DrawPath($penIconBorder, $iconPath)
        $penIconBorder.Dispose()
        $iconPath.Dispose()

        # Draw Emoji Icon
        $iconBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
        $iconTextRect = [System.Drawing.RectangleF]::new($iconBoxX, $iconBoxY + 5, $iconBoxSize, $iconBoxSize)
        $g.DrawString($item.Icon, $fontIcon, $iconBrush, $iconTextRect, $sf)
        $iconBrush.Dispose()

        # 3. Draw Category Pill Tag
        $tagW = 200
        $tagH = 44
        $tagX = $rx + (($rw - $tagW) / 2)
        $tagY = $ry + 205
        $tagRect = [System.Drawing.RectangleF]::new($tagX, $tagY, $tagW, $tagH)
        $tagPath = Get-RoundedPath -Rect $tagRect -Radius 22
        $tagBgColor = [System.Drawing.ColorTranslator]::FromHtml($item.TagBg)
        $tagBgBrush = [System.Drawing.SolidBrush]::new($tagBgColor)
        $g.FillPath($tagBgBrush, $tagPath)
        $tagBgBrush.Dispose()

        $penTag = [System.Drawing.Pen]::new($cAccent, 1.5)
        $g.DrawPath($penTag, $tagPath)
        $penTag.Dispose()
        $tagPath.Dispose()

        $tagTextBrush = [System.Drawing.SolidBrush]::new($cAccent)
        $g.DrawString($item.Tag, $fontTag, $tagTextBrush, $tagRect, $sf)
        $tagTextBrush.Dispose()

        # 4. Draw Main Title
        $titleBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml("#FFFFFF"))
        $titleRect = [System.Drawing.RectangleF]::new($rx, ($ry + 270), $rw, 85)
        $g.DrawString($item.Title, $fontTitle, $titleBrush, $titleRect, $sf)
        $titleBrush.Dispose()

        # 5. Draw Descriptions
        $cDesc = [System.Drawing.ColorTranslator]::FromHtml($item.DescColor)
        $descBrush = [System.Drawing.SolidBrush]::new($cDesc)
        $descRect1 = [System.Drawing.RectangleF]::new($rx + 20, ($ry + 375), ($rw - 40), 55)
        $g.DrawString($item.Desc1, $fontDesc, $descBrush, $descRect1, $sf)

        $descRect2 = [System.Drawing.RectangleF]::new($rx + 20, ($ry + 435), ($rw - 40), 55)
        $g.DrawString($item.Desc2, $fontDesc, $descBrush, $descRect2, $sf)
        $descBrush.Dispose()

        # 6. Action Button Pill at Bottom
        $btnW = 340
        $btnH = 68
        $btnX = $rx + (($rw - $btnW) / 2)
        $btnY = $ry + 540
        $btnRect = [System.Drawing.RectangleF]::new($btnX, $btnY, $btnW, $btnH)
        $btnPath = Get-RoundedPath -Rect $btnRect -Radius 34
        
        $cBtnTop = [System.Drawing.ColorTranslator]::FromHtml($item.BtnBgTop)
        $cBtnBot = [System.Drawing.ColorTranslator]::FromHtml($item.BtnBgBot)
        $btnBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($btnRect, $cBtnTop, $cBtnBot, 90)
        $g.FillPath($btnBrush, $btnPath)
        $btnBrush.Dispose()

        $penBtn = [System.Drawing.Pen]::new($cAccent, 2)
        $g.DrawPath($penBtn, $btnPath)
        $penBtn.Dispose()
        $btnPath.Dispose()

        $btnTextBrush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($item.BtnTextColor))
        $g.DrawString($item.BtnText, $fontBtn, $btnTextBrush, $btnRect, $sf)
        $btnTextBrush.Dispose()

        $sf.Dispose()
    }

    # Save
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $g.Dispose()
    $fontTitle.Dispose()
    $fontIcon.Dispose()
    $fontTag.Dispose()
    $fontDesc.Dispose()
    $fontBtn.Dispose()
    Write-Output "Successfully generated modern rich menu: $Path"
}

# Landlord Items (上下方 6 格，包含「當前租約」)
$landlordItems = @(
    @{
        Icon = "📊"; Title = "經營概況"; Tag = "財務統計"
        Desc1 = "全站出租率與房源數"; Desc2 = "本月應收與實收租金"
        BtnText = "點擊查閱 ➔"
        CardBgTop = "#1E293B"; CardBgBot = "#111827"; BorderColor = "#334155"; AccentColor = "#38BDF8"
        DescColor = "#94A3B8"; TagBg = "#0C2340"
        IconBgTop = "#0C2A4D"; IconBgBot = "#16365C"; BtnBgTop = "#0F2847"; BtnBgBot = "#081A30"; BtnTextColor = "#38BDF8"
    },
    @{
        Icon = "⏳"; Title = "待核帳單"; Tag = "繳費審核"
        Desc1 = "租客自主繳款回報"; Desc2 = "一鍵核帳即刻開立收據"
        BtnText = "前往審核 ➔"
        CardBgTop = "#1E293B"; CardBgBot = "#111827"; BorderColor = "#4A3319"; AccentColor = "#F59E0B"
        DescColor = "#94A3B8"; TagBg = "#3D2405"
        IconBgTop = "#472704"; IconBgBot = "#5C3408"; BtnBgTop = "#4A2604"; BtnBgBot = "#261301"; BtnTextColor = "#FBBF24"
    },
    @{
        Icon = "📑"; Title = "當前租約"; Tag = "租約管理"
        Desc1 = "進行中租約與各房號"; Desc2 = "租期起訖與到期提醒"
        BtnText = "合約名冊 ➔"
        CardBgTop = "#1E293B"; CardBgBot = "#111827"; BorderColor = "#3B3363"; AccentColor = "#A78BFA"
        DescColor = "#94A3B8"; TagBg = "#2E1B4E"
        IconBgTop = "#311C54"; IconBgBot = "#432873"; BtnBgTop = "#2E1B4E"; BtnBgBot = "#170C29"; BtnTextColor = "#C4B5FD"
    },
    @{
        Icon = "➕"; Title = "新增帳單"; Tag = "快速開立"
        Desc1 = "開立待繳或登記入帳"; Desc2 = "即時同步網站與資料庫"
        BtnText = "新增帳單 ➔"
        CardBgTop = "#1E293B"; CardBgBot = "#111827"; BorderColor = "#10B981"; AccentColor = "#34D399"
        DescColor = "#94A3B8"; TagBg = "#064E3B"
        IconBgTop = "#065F46"; IconBgBot = "#047857"; BtnBgTop = "#065F46"; BtnBgBot = "#022C22"; BtnTextColor = "#6EE7B7"
    },
    @{
        Icon = "🌐"; Title = "管理後台"; Tag = "完整系統"
        Desc1 = "開啟雲端物業管理系統"; Desc2 = "自訂請款單與完整報表"
        BtnText = "開啟網頁 ➔"
        CardBgTop = "#1E293B"; CardBgBot = "#111827"; BorderColor = "#273E66"; AccentColor = "#60A5FA"
        DescColor = "#94A3B8"; TagBg = "#132A4A"
        IconBgTop = "#16345C"; IconBgBot = "#1F4880"; BtnBgTop = "#16345C"; BtnBgBot = "#0C1F38"; BtnTextColor = "#93C5FD"
    },
    @{
        Icon = "🔄"; Title = "切換為租客"; Tag = "身分切換"
        Desc1 = "一鍵切換租客生活選單"; Desc2 = "享有租客繳費與租約功能"
        BtnText = "切換模式 ➔"
        CardBgTop = "#2E1065"; CardBgBot = "#1E1B4B"; BorderColor = "#6366F1"; AccentColor = "#C084FC"
        DescColor = "#C4B5FD"; TagBg = "#4C1D95"
        IconBgTop = "#581C87"; IconBgBot = "#6B21A8"; BtnBgTop = "#5B21B6"; BtnBgBot = "#3B0764"; BtnTextColor = "#E9D5FF"
    }
)
Generate-ModernRichMenu -Path "public/richmenu_landlord.png" -Theme "landlord" -Items $landlordItems

# Tenant Dual Items (租客生活選單 - 雙身分版)
$tenantDualItems = @(
    @{
        Icon = "📋"; Title = "我的租約"; Tag = "合約資訊"
        Desc1 = "租期起訖與承租地址"; Desc2 = "房東資訊與押金憑據"
        BtnText = "查看租約 ➔"
        CardBgTop = "#065F46"; CardBgBot = "#022C22"; BorderColor = "#047857"; AccentColor = "#34D399"
        DescColor = "#A7F3D0"; TagBg = "#064E3B"
        IconBgTop = "#064E3B"; IconBgBot = "#0A694F"; BtnBgTop = "#064E3B"; BtnBgBot = "#022C22"; BtnTextColor = "#6EE7B7"
    },
    @{
        Icon = "⏳"; Title = "待繳帳單"; Tag = "應繳費用"
        Desc1 = "當期租金、水電、管理費"; Desc2 = "快速回報轉帳後五碼"
        BtnText = "立即回報 ➔"
        CardBgTop = "#065F46"; CardBgBot = "#022C22"; BorderColor = "#78350F"; AccentColor = "#FBBF24"
        DescColor = "#A7F3D0"; TagBg = "#451A03"
        IconBgTop = "#542605"; IconBgBot = "#78380A"; BtnBgTop = "#542605"; BtnBgBot = "#261102"; BtnTextColor = "#FDE68A"
    },
    @{
        Icon = "💰"; Title = "已繳紀錄"; Tag = "收據證明"
        Desc1 = "歷史繳款對帳紀錄"; Desc2 = "隨時開立與查驗電子收據"
        BtnText = "檢視紀錄 ➔"
        CardBgTop = "#065F46"; CardBgBot = "#022C22"; BorderColor = "#0D9488"; AccentColor = "#2DD4BF"
        DescColor = "#A7F3D0"; TagBg = "#115E59"
        IconBgTop = "#115E59"; IconBgBot = "#147A73"; BtnBgTop = "#115E59"; BtnBgBot = "#063330"; BtnTextColor = "#5EEAD4"
    },
    @{
        Icon = "🏦"; Title = "匯款帳號"; Tag = "約定帳戶"
        Desc1 = "約定收款銀行與戶名"; Desc2 = "一鍵複製帳號快速轉帳"
        BtnText = "複製帳號 ➔"
        CardBgTop = "#065F46"; CardBgBot = "#022C22"; BorderColor = "#1D4ED8"; AccentColor = "#60A5FA"
        DescColor = "#A7F3D0"; TagBg = "#1E3A8A"
        IconBgTop = "#1E3A8A"; IconBgBot = "#254AA8"; BtnBgTop = "#1E3A8A"; BtnBgBot = "#0F1F4A"; BtnTextColor = "#93C5FD"
    },
    @{
        Icon = "🌐"; Title = "租客專區"; Tag = "個人中心"
        Desc1 = "開啟手機專屬生活系統"; Desc2 = "即時查看更多詳細帳目"
        BtnText = "進入專區 ➔"
        CardBgTop = "#065F46"; CardBgBot = "#022C22"; BorderColor = "#15803D"; AccentColor = "#4ADE80"
        DescColor = "#A7F3D0"; TagBg = "#14532D"
        IconBgTop = "#14532D"; IconBgBot = "#1B6E3C"; BtnBgTop = "#14532D"; BtnBgBot = "#0A2E19"; BtnTextColor = "#86EFAC"
    },
    @{
        Icon = "🔄"; Title = "切換為房東"; Tag = "身分切換"
        Desc1 = "一鍵切換房東管理選單"; Desc2 = "享有物業經營管理權限"
        BtnText = "切換模式 ➔"
        CardBgTop = "#1E293B"; CardBgBot = "#0F172A"; BorderColor = "#6366F1"; AccentColor = "#818CF8"
        DescColor = "#CBD5E1"; TagBg = "#312E81"
        IconBgTop = "#312E81"; IconBgBot = "#4338CA"; BtnBgTop = "#312E81"; BtnBgBot = "#1E1B4B"; BtnTextColor = "#A5B4FC"
    }
)
Generate-ModernRichMenu -Path "public/richmenu_tenant.png" -Theme "tenant" -Items $tenantDualItems

# Tenant Standard Items (租客生活選單 - 純租客標準版，第 6 格為「申請成為房東」)
$tenantStandardItems = @(
    $tenantDualItems[0],
    $tenantDualItems[1],
    $tenantDualItems[2],
    $tenantDualItems[3],
    $tenantDualItems[4],
    @{
        Icon = "📝"; Title = "申請成為房東"; Tag = "權限開通"
        Desc1 = "名下持有出租物業"; Desc2 = "線上申請一鍵開通管理端"
        BtnText = "立即申請 ➔"
        CardBgTop = "#451A03"; CardBgBot = "#1C0B01"; BorderColor = "#D97706"; AccentColor = "#F59E0B"
        DescColor = "#FDE68A"; TagBg = "#78350F"
        IconBgTop = "#78350F"; IconBgBot = "#9A440D"; BtnBgTop = "#78350F"; BtnBgBot = "#3D1A05"; BtnTextColor = "#FCD34D"
    }
)
Generate-ModernRichMenu -Path "public/richmenu_tenant_standard.png" -Theme "tenant" -Items $tenantStandardItems
`;

// Save with UTF-8 BOM
const bom = '\uFEFF';
fs.writeFileSync('scripts/draw_rich_menus_bom.ps1', bom + psCode, 'utf8');

console.log('Generating Modern Rich Menus with PowerShell...');
const res = execSync('powershell -ExecutionPolicy Bypass -File scripts/draw_rich_menus_bom.ps1', { encoding: 'utf8' });
console.log(res);

const sStat = fs.statSync('public/richmenu_tenant_standard.png');
const tStat = fs.statSync('public/richmenu_tenant.png');
const lStat = fs.statSync('public/richmenu_landlord.png');
console.log(`Standard Tenant Menu: ${(sStat.size / 1024).toFixed(1)} KB`);
console.log(`Dual Tenant Menu: ${(tStat.size / 1024).toFixed(1)} KB`);
console.log(`Landlord Menu: ${(lStat.size / 1024).toFixed(1)} KB`);
