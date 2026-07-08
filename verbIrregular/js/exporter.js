/**
 * exporter.js - 匯出工具層 (Utility Layer)
 */

import { state } from './store.js';

// 產生格式化日期：YYYYMMDD
function getFormattedDate() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
}

// ==========================================
// 1. 匯出 CSV 錯題紀錄
// ==========================================
export function exportToCSV() {
    if (state.history.length === 0) {
        alert("目前沒有成績紀錄可供匯出。");
        return;
    }
    const currentRecord = state.history[state.history.length - 1];
    
    let csvContent = "學生姓名,交卷時間,測驗模式,得分,總題數\n";
    csvContent += `"${currentRecord.studentName}","${currentRecord.timestamp}","${currentRecord.mode}",${currentRecord.score},${currentRecord.total}\n\n`;
    
    if (currentRecord.mistakes && currentRecord.mistakes.length > 0) {
        csvContent += "=== 錯題明細 ===\n";
        csvContent += "動詞原型,空格ID,你的答案,正確答案\n";
        
        currentRecord.mistakes.forEach(mistake => {
            csvContent += `"${mistake.verb}","${mistake.blankId}","${mistake.userAns}","${mistake.correctAns}"\n`;
        });
    } else {
        csvContent += "太棒了！本次測驗全對，沒有錯題。\n";
    }

    const BOM = "\uFEFF"; 
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // 組裝自訂檔名: YYYYMMDD_StudentName_verbIrregular-Quiz.csv
    const dateStr = getFormattedDate();
    const fileName = `${dateStr}_${state.user.name}_verbIrregular-Quiz.csv`;

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==========================================
// 2. 匯出 PDF 考卷畫面
// ==========================================
export async function exportToPDF() {
    const reviewContainer = document.getElementById('review-container');
    
    if (!reviewContainer.innerHTML.trim()) {
        alert("沒有可匯出的檢討畫面。");
        return;
    }

    const btnPdf = document.getElementById('btn-export-pdf');
    const originalText = btnPdf.innerText;
    btnPdf.innerText = "產生 PDF 中，請稍候...";
    btnPdf.disabled = true;

    try {
        const appElement = document.getElementById('app');
        const actionPanel = document.querySelector('.action-panel');
        
        actionPanel.style.display = 'none';

        // 設定背景色為新的 --color-card 以確保 PDF 背景純白好看
        const canvas = await html2canvas(appElement, {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff" 
        });

        actionPanel.style.display = 'flex';

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');

        const imgData = canvas.toDataURL('image/png');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

        pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        
        // 組裝自訂檔名: YYYYMMDD_StudentName_verbIrregular-Quiz.pdf
        const dateStr = getFormattedDate();
        const fileName = `${dateStr}_${state.user.name}_verbIrregular-Quiz.pdf`;
        
        pdf.save(fileName);

    } catch (error) {
        console.error("PDF 產生失敗:", error);
        alert("PDF 匯出時發生錯誤。");
        document.querySelector('.action-panel').style.display = 'flex';
    } finally {
        btnPdf.innerText = originalText;
        btnPdf.disabled = false;
    }
}
