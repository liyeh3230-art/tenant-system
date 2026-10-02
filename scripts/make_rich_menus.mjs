import fs from 'fs';
import { execSync } from 'child_process';

const psCode = `
Add-Type -AssemblyName System.Drawing

function Generate-RichMenu {
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

    # Theme colors
    if ($Theme -eq "landlord") {
        $bgMain = [System.Drawing.ColorTranslator]::FromHtml("#0F172A") # Slate 900
        $cardBg = [System.Drawing.ColorTranslator]::FromHtml("#1E293B") # Slate 800
        $cardBorder = [System.Drawing.ColorTranslator]::FromHtml("#334155")
        $titleColor = [System.Drawing.ColorTranslator]::FromHtml("#F8FAFC")
        $descColor = [System.Drawing.ColorTranslator]::FromHtml("#94A3B8")
        $switchBg = [System.Drawing.ColorTranslator]::FromHtml("#312E81") # Indigo 900
        $switchBorder = [System.Drawing.ColorTranslator]::FromHtml("#6366F1")
        $badgeBg = [System.Drawing.ColorTranslator]::FromHtml("#D97706") # Amber
    } else {
        $bgMain = [System.Drawing.ColorTranslator]::FromHtml("#064E3B") # Emerald 900
        $cardBg = [System.Drawing.ColorTranslator]::FromHtml("#065F46") # Emerald 800
        $cardBorder = [System.Drawing.ColorTranslator]::FromHtml("#047857")
        $titleColor = [System.Drawing.ColorTranslator]::FromHtml("#FFFFFF")
        $descColor = [System.Drawing.ColorTranslator]::FromHtml("#A7F3D0")
        $switchBg = [System.Drawing.ColorTranslator]::FromHtml("#1E293B") # Slate 800
        $switchBorder = [System.Drawing.ColorTranslator]::FromHtml("#475569")
        $badgeBg = [System.Drawing.ColorTranslator]::FromHtml("#059669") # Emerald
    }

    # Fill background
    $bgBrush = [System.Drawing.SolidBrush]::new($bgMain)
    $g.FillRectangle($bgBrush, 0, 0, $width, $height)
    $bgBrush.Dispose()

    # Fonts
    $fontFamily = "Microsoft JhengHei"
    $fontTitle = [System.Drawing.Font]::new($fontFamily, 52, [System.Drawing.FontStyle]::Bold)
    $fontDesc = [System.Drawing.Font]::new($fontFamily, 28, [System.Drawing.FontStyle]::Regular)
    $fontTag = [System.Drawing.Font]::new($fontFamily, 22, [System.Drawing.FontStyle]::Bold)

    $cellW = 833
    $cellH = 843
    $padding = 24

    for ($i = 0; $i -lt 6; $i++) {
        $col = $i % 3
        $row = [Math]::Floor($i / 3)
        $x = $col * $cellW
        $y = $row * $cellH
        $w = if ($col -eq 2) { 2500 - $x } else { $cellW }
        $h = $cellH

        $item = $Items[$i]
        $isSwitch = ($i -eq 5)

        # Card rect inside padding
        $rx = $x + $padding
        $ry = $y + $padding
        $rw = $w - ($padding * 2)
        $rh = $h - ($padding * 2)

        # Card Background
        $currentCardBg = if ($isSwitch) { $switchBg } else { $cardBg }
        $currentCardBorder = if ($isSwitch) { $switchBorder } else { $cardBorder }

        $cardBrush = [System.Drawing.SolidBrush]::new($currentCardBg)
        $pen = [System.Drawing.Pen]::new($currentCardBorder, 4)

        # Draw card
        $g.FillRectangle($cardBrush, $rx, $ry, $rw, $rh)
        $g.DrawRectangle($pen, $rx, $ry, $rw, $rh)

        $cardBrush.Dispose()
        $pen.Dispose()

        # Text strings
        $title = $item.Title
        $desc1 = $item.Desc1
        $desc2 = $item.Desc2

        # Formatters
        $sf = [System.Drawing.StringFormat]::new()
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

        # Draw Title
        $titleBrush = [System.Drawing.SolidBrush]::new($titleColor)
        $titleRect = [System.Drawing.RectangleF]::new($rx, ($ry + 180), $rw, 120)
        $g.DrawString($title, $fontTitle, $titleBrush, $titleRect, $sf)
        $titleBrush.Dispose()

        # Draw Descs
        $descBrush = [System.Drawing.SolidBrush]::new($descColor)
        $descRect1 = [System.Drawing.RectangleF]::new($rx, ($ry + 340), $rw, 70)
        $g.DrawString($desc1, $fontDesc, $descBrush, $descRect1, $sf)

        $descRect2 = [System.Drawing.RectangleF]::new($rx, ($ry + 420), $rw, 70)
        $g.DrawString($desc2, $fontDesc, $descBrush, $descRect2, $sf)
        $descBrush.Dispose()

        # Decorative bottom bar
        $barColor = if ($isSwitch) { $switchBorder } else { $currentCardBorder }
        $barBrush = [System.Drawing.SolidBrush]::new($barColor)
        $g.FillRectangle($barBrush, ($rx + 60), ($ry + $rh - 40), ($rw - 120), 8)
        $barBrush.Dispose()

        $sf.Dispose()
    }

    # Save
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $g.Dispose()
    $fontTitle.Dispose()
    $fontDesc.Dispose()
    $fontTag.Dispose()
    Write-Output "Successfully generated: $Path"
}

# 1. 產生租客版 6 宮格
$tenantItems = @(
    @{ Title = "📋 我的租約"; Desc1 = "租期起訖與地址標的"; Desc2 = "出租甲方與承租人" },
    @{ Title = "⏳ 待繳帳單"; Desc1 = "當期租金與管理費"; Desc2 = "末五碼或現金回報" },
    @{ Title = "💰 已繳紀錄"; Desc1 = "歷史繳款對帳紀錄"; Desc2 = "即時開立電子收據" },
    @{ Title = "🏦 匯款帳號"; Desc1 = "約定收款銀行帳號"; Desc2 = "一鍵複製銀行代碼" },
    @{ Title = "🌐 租客專區"; Desc1 = "開啟個人網頁中心"; Desc2 = "即時查看更多詳情" },
    @{ Title = "🔄 切換為房東"; Desc1 = "一鍵切換管理模式"; Desc2 = "享有房東管理權限" }
)
Generate-RichMenu -Path "public/richmenu_tenant.png" -Theme "tenant" -Items $tenantItems

# 2. 產生房東版 6 宮格
$landlordItems = @(
    @{ Title = "📊 經營概況"; Desc1 = "房源總數與出租率"; Desc2 = "本月應收與已收金額" },
    @{ Title = "⏳ 待核帳單"; Desc1 = "租客繳款待審核"; Desc2 = "一鍵確認入帳收據" },
    @{ Title = "🏠 房源現況"; Desc1 = "空置招租與已出租"; Desc2 = "各房號租金狀態" },
    @{ Title = "📋 租客名冊"; Desc1 = "旗下房客合約列表"; Desc2 = "合約到期即時提醒" },
    @{ Title = "🌐 管理後台"; Desc1 = "開啟網頁版管理台"; Desc2 = "完整房產經營工具" },
    @{ Title = "🔄 切換為租客"; Desc1 = "一鍵切換生活模式"; Desc2 = "享有租客繳費功能" }
)
Generate-RichMenu -Path "public/richmenu_landlord.png" -Theme "landlord" -Items $landlordItems
`;

// Save with UTF-8 BOM
const bom = '\uFEFF';
fs.writeFileSync('scripts/draw_rich_menus_bom.ps1', bom + psCode, 'utf8');

console.log('Running PowerShell drawing script with UTF-8 BOM...');
const res = execSync('powershell -ExecutionPolicy Bypass -File scripts/draw_rich_menus_bom.ps1', { encoding: 'utf8' });
console.log(res);

const tStat = fs.statSync('public/richmenu_tenant.png');
const lStat = fs.statSync('public/richmenu_landlord.png');
console.log(`Tenant Menu size: ${(tStat.size / 1024).toFixed(1)} KB`);
console.log(`Landlord Menu size: ${(lStat.size / 1024).toFixed(1)} KB`);
