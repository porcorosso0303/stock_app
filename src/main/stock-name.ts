const MAX_STOCK_NAME_LENGTH = 80;
const INVALID_WINDOWS_FILENAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const TRAILING_WINDOWS_FILENAME_CHARACTERS = /[ .]+$/g;

export function validateStockName(value: string): string {
  const stockName = value.trim();
  if (!stockName) {
    throw new Error("请输入A股标的名称");
  }
  if (stockName.length > MAX_STOCK_NAME_LENGTH) {
    throw new Error("A股标的名称不能超过80个字符");
  }
  if (/[\u0000-\u001f\u007f]/.test(stockName)) {
    throw new Error("A股标的名称只能包含单行文本");
  }
  return stockName;
}

export function sanitizeWindowsFilePart(value: string): string {
  const sanitized = value
    .replace(INVALID_WINDOWS_FILENAME_CHARACTERS, "_")
    .replace(TRAILING_WINDOWS_FILENAME_CHARACTERS, "");
  return sanitized || "_";
}

export function buildPdfFileName(stockName: string, date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const day = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join("-");
  const time = [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");

  return `${sanitizeWindowsFilePart(stockName)}_${day}_${time}.pdf`;
}
