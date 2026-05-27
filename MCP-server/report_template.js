/**
 * report_template.js
 * ─────────────────────────────────────────────────────────────────
 * docx.js 报告模板骨架 —— 纯格式定义，零业务数据
 *
 * 使用方式：
 *   此文件由 generate_docx_report() MCP 工具自动 require() 加载，
 *   LLM 只需提供 report_data（定义三个变量即可）：
 *
 *   ① REPORT_HEADER_TEXT  —— 页眉文字字符串
 *   ② REPORT_SECTIONS     —— 文档 body 内容数组（用下方暴露的工具函数构造）
 *   ③ OUTPUT_PATH         —— 输出 .docx 的绝对路径（工具自动注入，可写占位符）
 *
 * 暴露的工具函数（LLM 可直接使用）：
 *   cell(text, bg, bold, span, color)  — 普通表格单元格
 *   hcell(text, span)                  — 深蓝表头单元格
 *   p(text, opts)                      — 正文段落  opts:{size,bold,color}
 *   h1(text) / h2(text) / h3(text)     — 三级标题
 *   bullet(text)                       — 红点项目符号
 *   codeBlock(text)                    — 代码/命令块（左红边框）
 *   spacer()                           — 空行占位
 *   alertBox(label, text, labelBg, boxBg) — 警示框（双列表格）
 *   infoTable(headers, rows, colWidths)   — 快速生成数据表格
 *     headers   : string[]             表头文字
 *     rows      : string[][]           数据行
 *     colWidths : number[]             各列宽（DXA，需合计 9360）
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  HeadingLevel, AlignmentType,
  BorderStyle, WidthType, ShadingType,
  Header,
} = require('docx');
const fs = require('fs');

// ══════════════════════════════════════════════════════════════════
// 一、基础边框样式常量
// ══════════════════════════════════════════════════════════════════

const _border  = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const _borders = { top: _border, bottom: _border, left: _border, right: _border };

const _rBorder  = { style: BorderStyle.SINGLE, size: 2, color: 'CC0000' };
const _rBorders = { top: _rBorder, bottom: _rBorder, left: _rBorder, right: _rBorder };

// ══════════════════════════════════════════════════════════════════
// 二、工具函数定义
// ══════════════════════════════════════════════════════════════════

/**
 * 普通表格单元格
 * @param {string} text      单元格文字
 * @param {string} bg        背景色（hex，不带#），默认 FFFFFF
 * @param {boolean} bold     是否加粗，默认 false
 * @param {number} span      跨列数，默认 1
 * @param {string} color     字色（hex），默认 333333
 */
function cell(text, bg = 'FFFFFF', bold = false, span = 1, color = '333333') {
  return new TableCell({
    columnSpan: span,
    borders: _borders,
    width: { size: 0, type: WidthType.AUTO },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text: String(text), bold, size: 18, font: 'Arial', color })]
    })]
  });
}

/**
 * 深蓝表头单元格（白字加粗）
 * @param {string} text
 * @param {number} span 跨列数，默认 1
 */
function hcell(text, span = 1) {
  return cell(text, '1F3864', true, span, 'FFFFFF');
}

/**
 * 正文段落
 * @param {string} text
 * @param {{ size?: number, bold?: boolean, color?: string }} opts
 */
function p(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    children: [new TextRun({
      text: String(text),
      size:  opts.size  ?? 20,
      bold:  opts.bold  ?? false,
      color: opts.color ?? '333333',
      font: 'Arial',
    })]
  });
}

/** 一级红色标题（带底部红线） */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 320, after: 160 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CC0000', space: 4 } },
    children: [new TextRun({ text, size: 32, bold: true, color: 'CC0000', font: 'Arial' })]
  });
}

/** 二级深蓝标题 */
function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, size: 26, bold: true, color: '1F3864', font: 'Arial' })]
  });
}

/** 三级标题 */
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 160, after: 80 },
    children: [new TextRun({ text, size: 22, bold: true, color: '2E5090', font: 'Arial' })]
  });
}

/** 红点项目符号段落 */
function bullet(text) {
  return new Paragraph({
    spacing: { before: 40, after: 40 },
    indent: { left: 360, hanging: 240 },
    children: [
      new TextRun({ text: '• ', size: 20, color: 'CC0000', font: 'Arial' }),
      new TextRun({ text: String(text), size: 20, color: '333333', font: 'Arial' }),
    ]
  });
}

/** 代码/命令块（左侧红色竖线 + 浅红背景） */
function codeBlock(text) {
  return new Paragraph({
    spacing: { before: 80, after: 80 },
    indent: { left: 360 },
    border: { left: { style: BorderStyle.SINGLE, size: 8, color: 'CC0000', space: 4 } },
    shading: { fill: 'F8F0F0', type: ShadingType.CLEAR },
    children: [new TextRun({ text: String(text), size: 18, font: 'Courier New', color: '8B0000' })]
  });
}

/** 空行占位符 */
function spacer() {
  return new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun('')] });
}

/**
 * 双列警示框
 * @param {string} label    左侧标签文字（如 "严重" / "警告"）
 * @param {string} text     右侧说明文字
 * @param {string} labelBg  左列背景色，默认 CC0000（红）
 * @param {string} boxBg    右列背景色，默认 FFF0F0（浅红）
 */
function alertBox(label, text, labelBg = 'CC0000', boxBg = 'FFF0F0') {
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1200, 8160],
    rows: [new TableRow({ children: [
      new TableCell({
        borders: _rBorders,
        width: { size: 1200, type: WidthType.DXA },
        shading: { fill: labelBg, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({ text: String(label), bold: true, size: 18, font: 'Arial', color: 'FFFFFF' })]
        })]
      }),
      new TableCell({
        borders: _rBorders,
        width: { size: 8160, type: WidthType.DXA },
        shading: { fill: boxBg, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          children: [new TextRun({ text: String(text), size: 18, font: 'Arial', color: '333333' })]
        })]
      }),
    ]})],
  });
}

/**
 * 快速数据表格（LLM 友好，不需要手写 TableRow/TableCell）
 *
 * @param {string[]}   headers    表头数组，例如 ["指标", "数值", "说明"]
 * @param {string[][]} rows       数据行二维数组
 * @param {number[]}   colWidths  各列宽（DXA），需合计等于 9360（US Letter 正文宽）
 *                                不传则自动平均分配
 *
 * @example
 * infoTable(
 *   ["文件", "大小", "类型"],
 *   [
 *     ["index.js", "22 KB", "混淆JS"],
 *     ["shell.php", "4 KB",  "Webshell"],
 *   ],
 *   [3120, 3120, 3120]
 * )
 */
function infoTable(headers, rows, colWidths) {
  const colCount = headers.length;
  // 自动平均分配列宽
  const widths = colWidths && colWidths.length === colCount
    ? colWidths
    : Array(colCount).fill(Math.floor(9360 / colCount));

  const tableRows = [
    // 表头行
    new TableRow({
      children: headers.map((h, i) =>
        new TableCell({
          borders: _borders,
          width: { size: widths[i], type: WidthType.DXA },
          shading: { fill: '1F3864', type: ShadingType.CLEAR },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: String(h), bold: true, size: 18, font: 'Arial', color: 'FFFFFF' })]
          })]
        })
      )
    }),
    // 数据行（奇偶行交替背景）
    ...rows.map((row, ri) =>
      new TableRow({
        children: row.map((cellText, ci) =>
          new TableCell({
            borders: _borders,
            width: { size: widths[ci], type: WidthType.DXA },
            shading: { fill: ri % 2 === 0 ? 'F5F5F5' : 'FFFFFF', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: String(cellText), size: 18, font: 'Arial', color: '333333' })]
            })]
          })
        )
      })
    )
  ];

  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: widths,
    rows: tableRows,
  });
}

// ══════════════════════════════════════════════════════════════════
// 三、文档组装函数（由 MCP 工具调用，LLM 无需关心）
// ══════════════════════════════════════════════════════════════════

/**
 * 组装并写出 docx 文件
 * @param {string}   headerText  页眉文字
 * @param {any[]}    sections    文档 body children 数组
 * @param {string}   outputPath  输出文件绝对路径
 * @returns {Promise<void>}
 */
function buildDocument(headerText, sections, outputPath) {
  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'Arial', size: 20 } } },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal',
          run: { size: 32, bold: true, font: 'Arial', color: 'CC0000' },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal',
          run: { size: 26, bold: true, font: 'Arial', color: '1F3864' },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal',
          run: { size: 22, bold: true, font: 'Arial', color: '2E5090' },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CC0000', space: 4 } },
            children: [new TextRun({ text: String(headerText), bold: true, size: 20, font: 'Arial', color: 'CC0000' })]
          })]
        }),
      },
      children: sections,
    }],
  });

  return Packer.toBuffer(doc).then(buf => fs.writeFileSync(outputPath, buf));
}

// ══════════════════════════════════════════════════════════════════
// 四、模块导出（供 MCP 工具的 runner 脚本 require）
// ══════════════════════════════════════════════════════════════════
module.exports = {
  // 工具函数（LLM 在 report_data 中使用）
  cell, hcell, p, h1, h2, h3, bullet, codeBlock, spacer, alertBox, infoTable,
  // docx.js 原生类（供 LLM 在 report_data 里构造 Table/TableRow/TableCell 等）
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  // 组装函数（由 MCP runner 调用）
  buildDocument,
};