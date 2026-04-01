import { PipelineStep, ModelResponse, UsageEvent } from './types'

interface ExportData {
  title: string
  timestamp: string
  pipelineSteps?: PipelineStep[]
  responses?: ModelResponse[]
  usageHistory?: UsageEvent[]
  totalCost?: number
  totalTokens?: number
  latency?: number
}

// CSV Export Functions
export function exportToCSV(data: ExportData): string {
  const rows: string[] = []
  
  // Header
  rows.push(['Step ID', 'Type', 'Label', 'Status', 'Model', 'Tokens', 'Latency (ms)', 'Cost ($)', 'Result'].join(','))
  
  // Data rows
  if (data.pipelineSteps) {
    data.pipelineSteps.forEach(step => {
      const resultPreview = step.result 
        ? `"${step.result.slice(0, 100).replace(/"/g, '""').replace(/\n/g, ' ')}${step.result.length > 100 ? '...' : ''}"`
        : ''
      
      rows.push([
        step.nodeId,
        step.type,
        `"${step.label}"`,
        step.status,
        step.modelName || step.modelId || 'N/A',
        step.tokens || 0,
        step.latencyMs || 0,
        ((step.promptCost || 0) + (step.completionCost || 0)).toFixed(6),
        resultPreview
      ].join(','))
    })
  }
  
  // Summary row
  rows.push(['', '', '', '', '', '', '', '', ''].join(','))
  rows.push(['Summary', '', '', '', '', data.totalTokens || 0, data.latency || 0, (data.totalCost || 0).toFixed(6), ''].join(','))
  
  return rows.join('\n')
}

export function downloadCSV(data: ExportData, filename?: string): void {
  const csv = exportToCSV(data)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename || `pipeline-report-${new Date().toISOString().slice(0, 10)}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// PDF Export Functions (using print-friendly HTML)
export function generatePDFContent(data: ExportData): string {
  const date = new Date().toLocaleString()
  
  const stepsHtml = data.pipelineSteps?.map(step => `
    <div class="step" style="margin-bottom: 20px; border: 1px solid #ddd; padding: 15px; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <h3 style="margin: 0; color: #333;">${step.label} <span style="font-size: 12px; color: #666;">(${step.type})</span></h3>
        <span class="status ${step.status}" style="
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          ${step.status === 'completed' ? 'background: #d4edda; color: #155724;' : ''}
          ${step.status === 'error' ? 'background: #f8d7da; color: #721c24;' : ''}
          ${step.status === 'running' ? 'background: #fff3cd; color: #856404;' : ''}
          ${step.status === 'idle' ? 'background: #e2e3e5; color: #383d41;' : ''}
        ">${step.status}</span>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 15px; font-size: 13px;">
        <div><strong>Model:</strong> ${step.modelName || step.modelId || 'N/A'}</div>
        <div><strong>Tokens:</strong> ${step.tokens?.toLocaleString() || 0}</div>
        <div><strong>Latency:</strong> ${step.latencyMs ? `${step.latencyMs}ms` : 'N/A'}</div>
        <div><strong>Prompt Cost:</strong> $${(step.promptCost || 0).toFixed(6)}</div>
        <div><strong>Completion Cost:</strong> $${(step.completionCost || 0).toFixed(6)}</div>
        <div><strong>Total Cost:</strong> $${((step.promptCost || 0) + (step.completionCost || 0)).toFixed(6)}</div>
      </div>
      
      ${step.result ? `
        <div style="background: #f8f9fa; padding: 12px; border-radius: 6px; margin-top: 10px;">
          <strong>Result:</strong>
          <pre style="margin: 8px 0 0 0; white-space: pre-wrap; word-wrap: break-word; font-size: 12px; color: #333; max-height: 300px; overflow: auto;">${step.result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
        </div>
      ` : ''}
    </div>
  `).join('') || '<p style="color: #666;">No pipeline steps available</p>'
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${data.title} - Report</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 30px;
      border-bottom: 3px solid #007bff;
    }
    .header h1 {
      margin: 0 0 10px 0;
      color: #007bff;
      font-size: 28px;
    }
    .header .meta {
      color: #666;
      font-size: 14px;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
      margin-bottom: 40px;
      padding: 20px;
      background: #f8f9fa;
      border-radius: 12px;
    }
    .summary-card {
      text-align: center;
      padding: 15px;
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .summary-card .value {
      font-size: 24px;
      font-weight: 700;
      color: #007bff;
    }
    .summary-card .label {
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin-top: 5px;
    }
    .section-title {
      font-size: 20px;
      margin: 30px 0 20px 0;
      color: #333;
      border-left: 4px solid #007bff;
      padding-left: 12px;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${data.title}</h1>
    <div class="meta">Generated on ${date}</div>
  </div>
  
  <div class="summary">
    <div class="summary-card">
      <div class="value">${data.pipelineSteps?.length || 0}</div>
      <div class="label">Total Steps</div>
    </div>
    <div class="summary-card">
      <div class="value">${data.totalTokens?.toLocaleString() || 0}</div>
      <div class="label">Total Tokens</div>
    </div>
    <div class="summary-card">
      <div class="value">$${(data.totalCost || 0).toFixed(4)}</div>
      <div class="label">Total Cost</div>
    </div>
    <div class="summary-card">
      <div class="value">${data.latency ? `${(data.latency / 1000).toFixed(2)}s` : 'N/A'}</div>
      <div class="label">Total Time</div>
    </div>
  </div>
  
  <h2 class="section-title">Pipeline Execution Details</h2>
  ${stepsHtml}
  
  <div class="no-print" style="margin-top: 40px; text-align: center; color: #999; font-size: 12px;">
    Report generated by Aggregator Arena
  </div>
</body>
</html>
  `.trim()
}

export function downloadPDF(data: ExportData, filename?: string): void {
  const html = generatePDFContent(data)
  const printWindow = window.open('', '_blank')
  
  if (printWindow) {
    printWindow.document.write(html)
    printWindow.document.close()
    
    // Wait for styles to load then print
    setTimeout(() => {
      printWindow.print()
    }, 250)
  } else {
    // Fallback: download as HTML if popup blocked
    const blob = new Blob([html], { type: 'text/html' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    
    link.setAttribute('href', url)
    link.setAttribute('download', filename || `pipeline-report-${new Date().toISOString().slice(0, 10)}.html`)
    link.click()
  }
}

// Batch Runner CSV Export
export function exportBatchResultsToCSV(
  inputs: string[],
  results: Array<{ input: string; output: string; modelId: string; latency: number; tokens: number }>
): string {
  const rows: string[] = []
  
  // Header
  rows.push(['Input', 'Output', 'Model', 'Latency (ms)', 'Tokens'].join(','))
  
  // Data rows
  results.forEach((result, index) => {
    const input = `"${result.input.slice(0, 200).replace(/"/g, '""').replace(/\n/g, ' ')}${result.input.length > 200 ? '...' : ''}"`
    const output = `"${result.output.slice(0, 500).replace(/"/g, '""').replace(/\n/g, ' ')}${result.output.length > 500 ? '...' : ''}"`
    
    rows.push([
      input,
      output,
      result.modelId,
      result.latency,
      result.tokens
    ].join(','))
  })
  
  return rows.join('\n')
}

export function downloadBatchResultsCSV(
  inputs: string[],
  results: Array<{ input: string; output: string; modelId: string; latency: number; tokens: number }>,
  filename?: string
): void {
  const csv = exportBatchResultsToCSV(inputs, results)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)
  
  link.setAttribute('href', url)
  link.setAttribute('download', filename || `batch-results-${new Date().toISOString().slice(0, 10)}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}
