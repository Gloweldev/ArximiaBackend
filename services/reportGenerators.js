const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Inventory = require('../models/Inventory');
const Client = require('../models/Client');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Configuración para generar gráficos
const width = 800;
const height = 400;
const chartCallback = (ChartJS) => {
  ChartJS.defaults.responsive = true;
  ChartJS.defaults.maintainAspectRatio = false;
};
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, chartCallback });

// Function to calculate date range
function calculateDateRange(period, dateRange) {
  let start, end;

  switch (period) {
    case 'week': {
      // Calcular la semana actual
      const now = new Date();
      start = new Date(now);
      start.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case 'month': {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case 'year': {
      const now = new Date();
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
      end.setHours(23, 59, 59, 999);
      break;
    }

    case 'custom': {
      if (dateRange) {
        start = new Date(dateRange.start);
        start.setHours(0, 0, 0, 0);
        end = new Date(dateRange.end);
        end.setHours(23, 59, 59, 999);
      } else {
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        end.setHours(23, 59, 59, 999);
      }
      break;
    }

    default: {
      const now = new Date();
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    }
  }

  return { start, end };
}

async function generateFinancialReport(clubs, period, dateRange) {
  try {
    const { start, end } = calculateDateRange(period, dateRange);
    const clubIds = clubs.map(id => new mongoose.Types.ObjectId(id));

    console.log('Generating Financial Report:');
    console.log('Period:', period);
    console.log('Date Range:', { start, end });
    console.log('Club IDs:', clubIds);

    // Obtener datos de ventas, gastos, productos y clientes
    const [salesData, expensesData, productData, customerData, inventoryData] = await Promise.all([
      // Ventas totales y tendencias
      Sale.aggregate([
        { $match: { clubId: { $in: clubIds }, created_at: { $gte: start, $lte: end } } },
        { $group: { 
          _id: null,
          totalSales: { $sum: '$total' },
          averageTicket: { $avg: '$total' },
          totalTransactions: { $sum: 1 }
        }}
      ]),
      
      // Gastos por categoría
      Expense.aggregate([
        { $match: { clubId: { $in: clubIds }, date: { $gte: start, $lte: end } } },
        { $group: { 
          _id: '$category',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }}
      ]),

      // Productos más vendidos
      Sale.aggregate([
        { $match: { clubId: { $in: clubIds }, created_at: { $gte: start, $lte: end } } },
        { $unwind: '$itemGroups' },
        { $unwind: '$itemGroups.items' },
        { $group: {
          _id: '$itemGroups.items.product_id',
          totalSales: { $sum: { $multiply: ['$itemGroups.items.quantity', '$itemGroups.items.unit_price'] } },
          quantity: { $sum: '$itemGroups.items.quantity' }
        }},
        { $sort: { totalSales: -1 } },
        { $limit: 10 }
      ]),

      // Métricas de clientes
      Sale.aggregate([
        { $match: { clubId: { $in: clubIds }, created_at: { $gte: start, $lte: end } } },
        { $group: {
          _id: '$client',
          totalSpent: { $sum: '$total' },
          visits: { $sum: 1 }
        }}
      ]),

      // Datos de inventario
      Inventory.aggregate([
        { $match: { clubId: { $in: clubIds } } },
        { $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          lowStock: {
            $sum: {
              $cond: [
                { $lt: ['$stock', 10] },
                1,
                0
              ]
            }
          }
        }}
      ])
    ]);

    // Add logging after data fetching
    console.log('Sales Data:', salesData);
    console.log('Expenses Data:', expensesData);
    console.log('Total Sales:', salesData[0]?.totalSales || 0);
    console.log('Total Expenses:', expensesData.reduce((sum, exp) => sum + exp.total, 0));

    const result = {
      period,
      dateRange: { start, end },
      financialMetrics: {
        sales: {
          total: salesData[0]?.totalSales || 0,
          averageTicket: salesData[0]?.averageTicket || 0,
          totalTransactions: salesData[0]?.totalTransactions || 0
        },
        expenses: {
          total: expensesData.reduce((sum, exp) => sum + exp.total, 0),
          byCategory: expensesData
        },
        netProfit: (salesData[0]?.totalSales || 0) - expensesData.reduce((sum, exp) => sum + exp.total, 0)
      },
      productMetrics: {
        topSellers: productData,
        inventory: {
          total: inventoryData[0]?.totalProducts || 0,
          lowStock: inventoryData[0]?.lowStock || 0
        }
      },
      customerMetrics: {
        total: customerData.length,
        active: customerData.filter(c => c.visits > 0).length,
        averageSpent: customerData.reduce((sum, c) => sum + c.totalSpent, 0) / customerData.length || 0
      }
    };

    console.log('Final Report Data:', result);
    return result;
  } catch (error) {
    console.error('Error generating financial report:', error);
    throw error;
  }
}

async function generateReport(config) {
  try {
    let buffer;
    if (config.format.toLowerCase() === 'excel') {
      buffer = await generateExcelReport(config);
      return {
        buffer,
        extension: 'xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      };
    } else {
      buffer = await generatePDFReport(config);
      return {
        buffer,
        extension: 'pdf',
        contentType: 'application/pdf'
      };
    }
  } catch (error) {
    console.error('Error en generateReport:', error);
    throw new Error('Error al generar el reporte');
  }
}

async function generatePDFReport(config) {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        bufferPages: true
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      // Use addCover instead of addEnhancedCover
      addCover(doc, config);
      
      // Resumen Ejecutivo
      doc.addPage();
      await addExecutiveSummary(doc, config.reportData, config);

      // Secciones Detalladas
      if (config.includeDetails) {
        await addSalesDetail(doc, config.reportData);
        await addExpensesDetail(doc, config.reportData);
        await addCashFlow(doc, config.reportData);
        await addInventoryAnalysis(doc, config.reportData);
        await addProfitabilityAnalysis(doc, config.reportData);
      }

      // Gráficos si están incluidos
      if (config.includeCharts) {
        await addCharts(doc, config.reportData);
      }

      // Anexos si hay notas personalizadas
      if (config.customNotes) {
        doc.moveDown(1);
        addAnnexes(doc, config);
      }

      // Agregar pie de página
      addFooter(doc, config);

      doc.end();
    } catch (error) {
      console.error('Error in generatePDFReport:', error);
      reject(error);
    }
  });
}

async function addEnhancedSalesDetail(doc, data, colors, styles) {
  // Agrupar ventas por categoría
  const salesByCategory = await Promise.all(
    data.productMetrics.topSellers.map(async sale => {
      const product = await Product.findById(sale._id);
      return {
        category: product?.category || 'Sin categoría',
        name: product?.name || 'Producto desconocido',
        sales: sale.totalSales,
        quantity: sale.quantity
      };
    })
  );

  // Agrupar por categoría
  const categorizedSales = salesByCategory.reduce((acc, sale) => {
    if (!acc[sale.category]) {
      acc[sale.category] = {
        total: 0,
        items: []
      };
    }
    acc[sale.category].total += sale.sales;
    acc[sale.category].items.push(sale);
    return acc;
  }, {});

  // Mostrar resumen por categoría con tabla mejorada
  doc.moveDown(2)
     .font('Helvetica-Bold')
     .fontSize(styles.sectionTitle.fontSize)
     .fillColor(colors.primary)
     .text('Ventas por Categoría', { underline: true });

  Object.entries(categorizedSales).forEach(([category, data]) => {
    doc.moveDown(1)
       .font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(colors.secondary)
       .text(`${category} - $${data.total.toLocaleString('es-MX')}`);

    // Tabla de productos
    const startY = doc.y;
    doc.font('Helvetica')
       .fontSize(11);

    // Headers
    drawTableRow(doc, ['Producto', 'Cantidad', 'Ventas'], startY, colors.background);

    // Datos
    data.items.forEach((item, index) => {
      const y = startY + (index + 1) * 20;
      drawTableRow(doc, [
        item.name,
        item.quantity.toString(),
        `$${item.sales.toLocaleString('es-MX')}`
      ], y);
    });
  });
}

function addCover(doc, config) {

  // Título del reporte
  doc.fontSize(28)
     .fillColor('#2D5D7C')
     .text('REPORTE FINANCIERO', { align: 'center' })
     .moveDown(2);

  // Información del período
  doc.fontSize(16)
     .fillColor('#4A4A4A')
     .text(`Período: ${formatPeriodText(config.metadata.period, config.metadata.dateRange)}`, { align: 'center' })
     .moveDown(1);

  // Club y fecha
  doc.fontSize(14)
     .text(`Club: ${config.metadata.clubs.join(', ')}`, { align: 'center' })
     .moveDown(0.5)
     .text(`Generado: ${new Date().toLocaleDateString('es-MX', {
       day: 'numeric',
       month: 'long',
       year: 'numeric'
     })}`, { align: 'center' });

  // Información del usuario
  doc.moveDown(2)
     .fontSize(12)
     .text(`Generado por: ${config.user.nombreCompleto}`)
     .text(`Rol: ${config.user.role}`);
}

async function addExecutiveSummary(doc, data, config) {
  doc.fontSize(20)
     .fillColor('#2D5D7C')
     .text('Resumen Ejecutivo', { underline: true })
     .moveDown(0.5);

  const metrics = [
    {
      label: 'Ventas Totales',
      value: data.financialMetrics.sales.total,
      previous: data.previousPeriod?.sales || 0
    },
    {
      label: 'Gastos Totales',
      value: data.financialMetrics.expenses.total,
      previous: data.previousPeriod?.expenses || 0
    },
    {
      label: 'Ganancia Neta',
      value: data.financialMetrics.netProfit,
      previous: data.previousPeriod?.netProfit || 0
    }
  ];

  metrics.forEach((metric) => {
    const safeValue = (typeof metric.value === 'number') ? metric.value : 0;
    const safePrevious = (typeof metric.previous === 'number') ? metric.previous : 0;
    const change = calculatePercentageChange(safeValue, safePrevious);
    const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    const color = change > 0 ? '#16a34a' : '#dc2626';
    
    doc.fontSize(14)
       .fillColor('#0f172a')
       .text(`${metric.label}`)
       .fontSize(16)
       .text(`$${safeValue.toLocaleString('es-MX')}`, { continued: true })
       .fontSize(12)
       .fillColor(color)
       .text(`  ${arrow} ${Math.abs(change).toFixed(1)}% vs período anterior`)
       .moveDown(0.5);
  });

  const margin = (data.financialMetrics.netProfit / data.financialMetrics.sales.total * 100) || 0;
  doc.moveDown(0.5)
     .fontSize(14)
     .fillColor('#2D5D7C')
     .text(`Margen de Ganancia: ${margin.toFixed(2)}%`)
     .moveDown(1);
}

async function addSalesDetail(doc, data) {
  doc.moveDown(1)
     .fontSize(16)
     .text('Detalle de Ventas', { underline: true })
     .moveDown(0.5);

  // Sección de ventas por categoría
  doc.fontSize(14).text('Ventas por Categoría').moveDown(0.5);

  // Tabla de ventas por categoría
  const tableTop = doc.y;
  const columnWidth = 150;
  
  doc.font('Helvetica-Bold');
  doc.text('Categoría', 50, tableTop);
  doc.text('Monto', 200, tableTop);
  doc.text('% del Total', 350, tableTop);
  doc.moveDown();

  doc.font('Helvetica');
  let y = doc.y;
  
  const totalSales = data.financialMetrics.sales.total;
  data.productMetrics.topSellers.forEach((product, index) => {
    const percentage = ((product.totalSales / totalSales) * 100).toFixed(1);
    doc.text(product.name || 'Sin categoría', 50, y);
    doc.text(`$${product.totalSales.toLocaleString('es-MX')}`, 200, y);
    doc.text(`${percentage}%`, 350, y);
    y += 20;
  });

  // Top 5 productos
  doc.moveDown(2);
  doc.fontSize(14).text('Top 5 Productos Más Vendidos').moveDown(0.5);

  data.productMetrics.topSellers.slice(0, 5).forEach((product, index) => {
    doc.fontSize(12)
       .text(`${index + 1}. ${product.name || 'Producto sin nombre'}`)
       .text(`   Ventas: $${product.totalSales.toLocaleString('es-MX')}`)
       .text(`   Cantidad: ${product.quantity} unidades`)
       .moveDown(0.5);
  });
}

async function addExpensesDetail(doc, data) {
  doc.moveDown(1)
     .fontSize(16)
     .text('Detalle de Gastos', { underline: true })
     .moveDown(0.5);

  // Gastos por categoría
  const expenses = data.financialMetrics.expenses.byCategory;
  const totalExpenses = data.financialMetrics.expenses.total;

  doc.fontSize(14).text('Gastos por Categoría').moveDown(0.5);

  // Tabla de gastos
  const tableTop = doc.y;
  doc.font('Helvetica-Bold');
  doc.text('Categoría', 50, tableTop);
  doc.text('Monto', 200, tableTop);
  doc.text('% del Total', 350, tableTop);
  doc.moveDown();

  doc.font('Helvetica');
  let y = doc.y;

  expenses.forEach(expense => {
    const percentage = ((expense.total / totalExpenses) * 100).toFixed(1);
    doc.text(expense._id || 'Sin categoría', 50, y);
    doc.text(`$${expense.total.toLocaleString('es-MX')}`, 200, y);
    doc.text(`${percentage}%`, 350, y);
    y += 20;
  });

  // Alertas de gastos
  doc.moveDown(2);
  doc.fontSize(14).text('Alertas de Gastos').moveDown(0.5);

  const highExpenses = expenses.filter(exp => 
    (exp.total / totalExpenses) > 0.3
  );

  if (highExpenses.length > 0) {
    doc.fontSize(12).text('Categorías con gastos significativos (>30%):').moveDown(0.5);
    highExpenses.forEach(exp => {
      doc.text(`• ${exp._id}: $${exp.total.toLocaleString('es-MX')}`);
    });
  } else {
    doc.fontSize(12).text('No hay alertas de gastos significativos');
  }
}

async function addCashFlow(doc, data) {
  doc.moveDown(1)
     .fontSize(16)
     .text('Flujo de Caja', { underline: true })
     .moveDown(0.5);

  // Resumen de flujo
  const inflow = data.financialMetrics.sales.total;
  const outflow = data.financialMetrics.expenses.total;
  const netFlow = inflow - outflow;

  // Tabla de flujo de caja
  doc.fontSize(14).text('Resumen de Flujo de Caja').moveDown(0.5);

  const entries = [
    { label: 'Entradas (Ventas)', value: inflow },
    { label: 'Salidas (Gastos)', value: outflow },
    { label: 'Flujo Neto', value: netFlow }
  ];

  entries.forEach((entry, index) => {
    const color = entry.value >= 0 ? '#16a34a' : '#dc2626';
    doc.fillColor('black')
       .text(entry.label, 50, doc.y)
       .fillColor(color)
       .text(`$${Math.abs(entry.value).toLocaleString('es-MX')}`, 300, doc.y)
       .moveDown();
  });

  // Balance acumulado
  doc.moveDown()
     .fillColor('black')
     .fontSize(14)
     .text('Balance Acumulado', { underline: true })
     .moveDown(0.5)
     .fontSize(12)
     .text(`$${netFlow.toLocaleString('es-MX')}`, { align: 'center' });
}

async function addInventoryAnalysis(doc, data) {
  doc.moveDown(1)
     .fontSize(16)
     .text('Análisis de Inventario', { underline: true })
     .moveDown(0.5);

  // Métricas generales
  doc.fontSize(14).text('Resumen de Inventario').moveDown(0.5);
  doc.fontSize(12)
     .text(`Total de Productos: ${data.productMetrics.inventory.total}`)
     .text(`Productos con Stock Bajo: ${data.productMetrics.inventory.lowStock}`)
     .moveDown(1);

  // Productos críticos
  if (data.productMetrics.inventory.lowStock > 0) {
    doc.fontSize(14).text('Productos con Stock Crítico').moveDown(0.5);
    doc.fontSize(12).text('Se recomienda reabastecer los siguientes productos:').moveDown(0.5);

    // Aquí deberías agregar la lista de productos con stock bajo
    // Asumiendo que tienes esta información en los datos
    data.productMetrics.topSellers
      .filter(p => p.stock < 10)
      .forEach(product => {
        doc.text(`• ${product.name}: ${product.stock} unidades`);
      });
  }
}

async function addProfitabilityAnalysis(doc, data) {
  doc.moveDown(1)
     .fontSize(16)
     .text('Análisis de Rentabilidad', { underline: true })
     .moveDown(0.5);

  // Margen de ganancia general
  const margin = (data.financialMetrics.netProfit / data.financialMetrics.sales.total * 100) || 0;
  
  doc.fontSize(14).text('Rentabilidad General').moveDown(0.5);
  doc.fontSize(12)
     .text(`Margen de Ganancia: ${margin.toFixed(2)}%`)
     .text(`Ganancia Neta: $${data.financialMetrics.netProfit.toLocaleString('es-MX')}`)
     .moveDown(1);

  // Productos más rentables
  doc.fontSize(14).text('Productos Más Rentables').moveDown(0.5);
  
  // Asumiendo que tienes esta información en los datos
  data.productMetrics.topSellers.slice(0, 5).forEach((product, index) => {
    const productMargin = ((product.totalSales - (product.quantity * product.cost)) / product.totalSales * 100);
    doc.fontSize(12)
       .text(`${index + 1}. ${product.name}`)
       .text(`   Margen: ${productMargin.toFixed(2)}%`)
       .text(`   Ganancia: $${(product.totalSales - (product.quantity * product.cost)).toLocaleString('es-MX')}`)
       .moveDown(0.5);
  });
}

function addAnnexes(doc, config) {
  if (!config.customNotes && !config.methodologyNotes) return;

  doc.addPage();
  doc.fontSize(16).text('Anexos', { underline: true }).moveDown(1);

  if (config.customNotes) {
    doc.fontSize(14).text('Notas Adicionales').moveDown(0.5);
    doc.fontSize(12).text(config.customNotes).moveDown(1);
  }

  if (config.methodologyNotes) {
    doc.fontSize(14).text('Notas Metodológicas').moveDown(0.5);
    doc.fontSize(12).text(config.methodologyNotes).moveDown(1);
  }

  // Metadatos del reporte
  doc.fontSize(14).text('Información del Reporte').moveDown(0.5);
  doc.fontSize(12)
     .text(`Generado por: ${config.user.nombreCompleto}`)
     .text(`Rol: ${config.user.role}`)
     .text(`Fecha de generación: ${new Date().toLocaleDateString('es-MX')}`)
     .text(`Periodo analizado: ${formatPeriodText(config.metadata.period, config.metadata.dateRange)}`);
}

// Funciones auxiliares para el PDF
function addHeader(doc, config) {
  doc.fontSize(24)
     .fillColor('black')
     .text('REPORTE FINANCIERO', { align: 'center' })
     .fontSize(16)
     .moveDown(0.5)
     .text(`Periodo: ${formatPeriodText(config.metadata.period, config.metadata.dateRange)}`, { align: 'center' })
     .moveDown(1)
     .fontSize(12)
     .text(`Generado por: ${config.user?.nombreCompleto}`)
     .text(`Fecha de generación: ${new Date().toLocaleDateString('es-MX')}`)
     .text(`Club(s): ${config.metadata.clubs.join(', ')}`);
}

async function addFinancialSummary(doc, data) {
  console.log('Adding Financial Summary Details:', {
    metrics: data.financialMetrics,
    productMetrics: data.productMetrics,
    customerMetrics: data.customerMetrics
  });

  // Añadir cabecera de resumen financiero con diseño moderno
  doc.moveDown(2)
     .fontSize(20)
     .fillColor('#1a1a1a')
     .text('Resumen Financiero', { align: 'center' })
     .moveDown(1);

  // Agregar KPIs principales con mejor formato
  const kpis = [
    { 
      label: 'Ventas Totales', 
      value: data.financialMetrics?.sales?.total || 0,
      previous: data.previousPeriodSales,
      icon: '💰'
    },
    { 
      label: 'Gastos Operativos', 
      value: data.financialMetrics?.expenses?.total || 0,
      previous: data.previousPeriodExpenses,
      icon: '📊'
    },
    { 
      label: 'Ganancia Neta', 
      value: data.financialMetrics?.netProfit || 0,
      previous: data.previousPeriodProfit,
      icon: '📈'
    }
  ];

  // Dibujar KPIs en cajas modernas
  kpis.forEach((kpi, index) => {
    const safeValue = (typeof kpi.value === 'number') ? kpi.value : 0;
    const safePrevious = (typeof kpi.previous === 'number') ? kpi.previous : 0;
    const change = calculatePercentageChange(safeValue, safePrevious);
    const changeIcon = change > 0 ? '↑' : change < 0 ? '↓' : '→';
    
    // Dibujar caja para cada KPI
    doc.rect(50 + (index * 170), doc.y, 150, 80)
       .fillAndStroke('#f8fafc', '#e2e8f0');
    
    doc.fontSize(16)
       .fillColor('#1a1a1a')
       .text(`${kpi.icon} ${kpi.label}`, 60 + (index * 170), doc.y - 70);
    
    doc.fontSize(14)
       .fillColor('#0f172a')
       .text(`$${safeValue.toLocaleString('es-MX')}`, 60 + (index * 170), doc.y + 10);
    
    doc.fontSize(12)
       .fillColor(change > 0 ? '#16a34a' : '#dc2626')
       .text(`${changeIcon} ${change.toFixed(1)}%`, 60 + (index * 170), doc.y + 5);
  });

  // Calcular margen de ganancia
  const margin = data.financialMetrics?.sales?.total 
    ? (data.financialMetrics.netProfit / data.financialMetrics.sales.total * 100)
    : 0;

  doc.moveDown(5)
     .fontSize(14)
     .fillColor('#1a1a1a')
     .text(`Margen de Ganancia: ${margin.toFixed(2)}%`, { align: 'center' });
}

async function addCharts(doc, data) {
  doc.addPage();
  doc.fontSize(16).text('Análisis Gráfico', { underline: true }).moveDown(1);

  // Gráfico de Ventas vs Gastos
  const salesVsExpenses = {
    type: 'bar',
    data: {
      labels: ['Ventas', 'Gastos', 'Ganancia Neta'],
      datasets: [{
        data: [
          data.financialMetrics.sales.total,
          data.financialMetrics.expenses.total,
          data.financialMetrics.netProfit
        ],
        backgroundColor: [
          'rgba(75, 192, 192, 0.6)',
          'rgba(255, 99, 132, 0.6)',
          'rgba(54, 162, 235, 0.6)'
        ]
      }]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true
        }
      },
      plugins: {
        title: {
          display: true,
          text: 'Resumen Financiero'
        }
      }
    }
  };

  const salesVsExpensesChart = await chartJSNodeCanvas.renderToBuffer(salesVsExpenses);
  doc.image(salesVsExpensesChart, { width: 500 }).moveDown(2);

  // Gráfico de Productos con Stock Bajo vs Normal
  const inventoryChart = {
    type: 'pie',
    data: {
      labels: ['Stock Normal', 'Stock Bajo'],
      datasets: [{
        data: [
          data.productMetrics.inventory.total - data.productMetrics.inventory.lowStock,
          data.productMetrics.inventory.lowStock
        ],
        backgroundColor: [
          'rgba(75, 192, 192, 0.6)',
          'rgba(255, 99, 132, 0.6)'
        ]
      }]
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: 'Estado del Inventario'
        }
      }
    }
  };

  const inventoryPieChart = await chartJSNodeCanvas.renderToBuffer(inventoryChart);
  doc.image(inventoryPieChart, { width: 400 }).moveDown(1);
}

async function addDetailedSection(doc, data) {
  doc.addPage();
  doc.fontSize(16).text('Análisis Detallado', { underline: true }).moveDown(1);

  // Sección de ventas detallada
  await addSalesSection(doc, data);
  
  // Sección de gastos detallada
  await addExpensesSection(doc, data);
  
  // Sección de inventario
  await addInventorySection(doc, data);
  
  // Sección de rentabilidad
  await addProfitabilitySection(doc, data);
}

async function addSalesSection(doc, data) {
  doc.fontSize(14)
     .fillColor('#1a1a1a')
     .text('Detalle de Ventas', { underline: true })
     .moveDown(0.5);

  // Ventas por categoría
  const salesByCategory = {
    sealed: data.productMetrics.topSellers.filter(p => p.type === 'sealed')
      .reduce((sum, p) => sum + p.totalSales, 0),
    prepared: data.productMetrics.topSellers.filter(p => p.type === 'prepared')
      .reduce((sum, p) => sum + p.totalSales, 0)
  };

  // Gráfico de distribución sellados vs preparados
  const categoryDistChart = {
    type: 'pie',
    data: {
      labels: ['Productos Sellados', 'Productos Preparados'],
      datasets: [{
        data: [salesByCategory.sealed, salesByCategory.prepared],
        backgroundColor: ['#60a5fa', '#34d399']
      }]
    },
    options: {
      plugins: {
        title: { display: true, text: 'Distribución de Ventas' },
        datalabels: {
          formatter: (value) => `$${value.toLocaleString('es-MX')}`
        }
      }
    }
  };

  const categoryChart = await chartJSNodeCanvas.renderToBuffer(categoryDistChart);
  doc.image(categoryChart, { width: 300, align: 'center' }).moveDown(1);
}

async function addExpensesSection(doc, data) {
  // Implementar sección de gastos detallada
}

async function addInventorySection(doc, data) {
  // Implementar sección de inventario
}

async function addProfitabilitySection(doc, data) {
  // Implementar sección de rentabilidad
}

// Funciones auxiliares para gráficos
async function generateTrendChart(data) {
  const safeData = Array.isArray(data) ? data : [];
  const config = {
    type: 'line',
    data: {
      labels: safeData.map(d => d.date),
      datasets: [
        {
          label: 'Ventas',
          data: safeData.map(d => d.sales),
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1
        },
        {
          label: 'Gastos',
          data: safeData.map(d => d.expenses),
          borderColor: 'rgb(255, 99, 132)',
          tension: 0.1
        }
      ]
    },
    options: {
      scales: {
        y: {
          beginAtZero: true
        }
      }
    }
  };

  return await chartJSNodeCanvas.renderToBuffer(config);
}

async function generateCategoryChart(data) {
  const safeData = Array.isArray(data) ? data : [];
  const config = {
    type: 'pie',
    data: {
      labels: safeData.map(d => d.category),
      datasets: [{
        data: safeData.map(d => Math.abs(d.amount)),
        backgroundColor: [
          'rgb(255, 99, 132)',
          'rgb(54, 162, 235)',
          'rgb(255, 206, 86)',
          'rgb(75, 192, 192)',
          'rgb(153, 102, 255)'
        ]
      }]
    }
  };

  return await chartJSNodeCanvas.renderToBuffer(config);
}

async function generateExcelReport(config) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = config.user.nombreCompleto;
  workbook.created = new Date();

  // Hoja de Resumen Financiero
  const summarySheet = workbook.addWorksheet('Resumen Financiero');
  configureSummarySheet(summarySheet, config);

  if (config.includeDetails) {
    // Hoja de Ventas Detalladas
    const salesSheet = workbook.addWorksheet('Ventas Detalladas');
    await configureSalesSheet(salesSheet, config);

    // Hoja de Gastos
    const expensesSheet = workbook.addWorksheet('Gastos');
    await configureExpensesSheet(expensesSheet, config);

    // Hoja de Inventario
    const inventorySheet = workbook.addWorksheet('Inventario');
    await configureInventorySheet(inventorySheet, config);

    // Hoja de Clientes
    const customersSheet = workbook.addWorksheet('Clientes');
    await configureCustomersSheet(customersSheet, config);
  }

  // Hoja de Gráficos si se incluyen
  if (config.includeCharts) {
    const chartsSheet = workbook.addWorksheet('Gráficos');
    await configureChartsSheet(chartsSheet, config);
  }

  return await workbook.xlsx.writeBuffer();
}

// Funciones auxiliares para PDF
function addHeader(doc, config) {
  doc.fontSize(20)
     .text('REPORTE FINANCIERO ARXIMIA', { align: 'center' })
     .moveDown();

  doc.fontSize(14)
     .text(`Periodo: ${formatPeriod(config.metadata.period, config.metadata.dateRange)}`, { align: 'center' })
     .moveDown();

  doc.fontSize(12)
     .text(`Generado por: ${config.user.nombreCompleto}`)
     .text(`Rol: ${config.user.role}`)
     .text(`Fecha de generación: ${new Date().toLocaleDateString('es-MX')}`)
     .text(`Clubs incluidos: ${config.metadata.clubs.join(', ')}`)
     .moveDown(2);
}

function formatPeriod(period, dateRange) {
  const formatDate = (date) => new Date(date).toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  switch (period) {
    case 'week':
      return `Semana del ${formatDate(dateRange.start)} al ${formatDate(dateRange.end)}`;
    case 'month':
      return new Date(dateRange.start).toLocaleDateString('es-MX', { 
        month: 'long',
        year: 'numeric'
      });
    case 'year':
      return `Año ${new Date(dateRange.start).getFullYear()}`;
    default:
      return `${formatDate(dateRange.start)} al ${formatDate(dateRange.end)}`;
  }
}

function formatPeriodText(period, dateRange) {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  console.log('Formatting Period:', { period, dateRange });
  
  const now = new Date(); // Use current date for default cases
  let formattedText;

  switch (period) {
    case 'month': {
      const date = dateRange ? new Date(dateRange.start) : now;
      formattedText = `${months[date.getMonth()]} ${date.getFullYear()}`;
      break;
    }
    case 'week': {
      // Usar la fecha de inicio proporcionada
      const start = new Date(dateRange.start);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      formattedText = `Semana del ${formatDate(start.toISOString())} al ${formatDate(end.toISOString())}`;
      break;
    }
    case 'year': {
      const start = new Date(dateRange.start);
      formattedText = `Año ${start.getFullYear()}`;
      break;
    }
    case 'custom':
    default:
      formattedText = `${formatDate(dateRange.start)} al ${formatDate(dateRange.end)}`;
  }

  console.log('Formatted Period Text:', formattedText);
  return formattedText;
}

function addFooter(doc, config) {
  doc.fontSize(10)
     .text('Reporte generado automáticamente por el sistema Arximia.', { align: 'center' })
     .text('Confidencial - Solo para uso interno.', { align: 'center' });
}

function addCustomNotes(doc, notes) {
  doc.fontSize(14).text('Notas Adicionales:', { underline: true });
  doc.fontSize(12).text(notes);
}

function configureSummarySheet(sheet, config) {
  const { reportData } = config;

  sheet.columns = [
    { header: 'Métrica', key: 'metric', width: 30 },
    { header: 'Valor', key: 'value', width: 20 },
    { header: 'Comparación', key: 'comparison', width: 25 }
  ];

  // Estilo para encabezados
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE6E6E6' }
  };

  // Añadir información de encabezado
  sheet.getCell('A1').value = 'REPORTE FINANCIERO ARXIMIA';
  sheet.getCell('A2').value = `Periodo: ${formatPeriod(config.metadata.period, config.metadata.dateRange)}`;
  sheet.getCell('A3').value = `Generado por: ${config.user.nombreCompleto}`;
  sheet.getCell('A4').value = `Fecha: ${new Date().toLocaleDateString('es-MX')}`;

  // Agregar datos financieros
  const data = [
    ['Ventas Totales', reportData.financialMetrics.sales.total, `${calculateChange(reportData.financialMetrics.sales.total, reportData.previousPeriod?.sales || 0)}%`],
    ['Gastos Totales', reportData.financialMetrics.expenses.total, `${calculateChange(reportData.financialMetrics.expenses.total, reportData.previousPeriod?.expenses || 0)}%`],
    ['Ganancia Neta', reportData.financialMetrics.netProfit, `${calculateChange(reportData.financialMetrics.netProfit, reportData.previousPeriod?.netProfit || 0)}%`],
    ['Ticket Promedio', reportData.financialMetrics.sales.averageTicket, ''],
    ['Total Transacciones', reportData.financialMetrics.sales.totalTransactions, '']
  ];

  data.forEach(row => sheet.addRow(row));
}

async function configureSalesSheet(sheet, config) {
  // Implementar detalles de ventas
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 20 },
    { header: 'Producto', key: 'product', width: 30 },
    { header: 'Cantidad', key: 'quantity', width: 15 },
    { header: 'Precio', key: 'price', width: 15 },
    { header: 'Total', key: 'total', width: 15 }
  ];

  // Agregar datos de ventas...
}

async function configureExpensesSheet(sheet, config) {
  // Implementar detalles de gastos
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 20 },
    { header: 'Categoría', key: 'category', width: 25 },
    { header: 'Descripción', key: 'description', width: 40 },
    { header: 'Monto', key: 'amount', width: 15 }
  ];

  // Agregar datos de gastos...
}

async function configureInventorySheet(sheet, config) {
  // Implementar detalles de inventario
  sheet.columns = [
    { header: 'Producto', key: 'product', width: 30 },
    { header: 'Stock', key: 'stock', width: 15 },
    { header: 'Estado', key: 'status', width: 20 }
  ];

  // Agregar datos de inventario...
}

async function configureCustomersSheet(sheet, config) {
  // Implementar detalles de clientes
  sheet.columns = [
    { header: 'Cliente', key: 'client', width: 30 },
    { header: 'Total Gastado', key: 'totalSpent', width: 20 },
    { header: 'Visitas', key: 'visits', width: 15 }
  ];

  // Agregar datos de clientes...
}

// Add this function to configure charts sheet
async function configureChartsSheet(sheet, config) {
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 15 },
    { header: 'Ventas', key: 'sales', width: 15 },
    { header: 'Gastos', key: 'expenses', width: 15 },
    { header: 'Balance', key: 'balance', width: 15 }
  ];

  // Estilo para encabezados
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE6E6E6' }
  };

  // Agregar título
  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'Gráficos y Tendencias';
  sheet.getCell('A1').font = { size: 14, bold: true };

  if (config.reportData && config.reportData.monthlyTrend) {
    const trendData = config.reportData.monthlyTrend;
    trendData.forEach((data, index) => {
      sheet.addRow({
        date: new Date(data.date).toLocaleDateString('es-MX'),
        sales: data.sales,
        expenses: data.expenses,
        balance: data.sales - data.expenses
      });
    });
  }
}

// Add configuration functions for other sheets
function configureSalesSheet(sheet, config) {
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 15 },
    { header: 'Total', key: 'total', width: 15 },
    { header: 'Cliente', key: 'client', width: 25 },
    { header: 'Productos', key: 'products', width: 40 }
  ];
  // Add sales data...
}

function configureExpensesSheet(sheet, config) {
  sheet.columns = [
    { header: 'Fecha', key: 'date', width: 15 },
    { header: 'Categoría', key: 'category', width: 20 },
    { header: 'Descripción', key: 'description', width: 30 },
    { header: 'Monto', key: 'amount', width: 15 }
  ];
  // Add expenses data...
}

function configureInventorySheet(sheet, config) {
  sheet.columns = [
    { header: 'Producto', key: 'product', width: 30 },
    { header: 'Stock', key: 'stock', width: 15 },
    { header: 'Valor', key: 'value', width: 15 }
  ];
  // Add inventory data...
}

function configureCustomersSheet(sheet, config) {
  sheet.columns = [
    { header: 'Cliente', key: 'client', width: 30 },
    { header: 'Total Compras', key: 'totalPurchases', width: 15 },
    { header: 'Última Compra', key: 'lastPurchase', width: 15 }
  ];
  // Add customer data...
}

function formatPeriodText(period, dateRange) {
  const months = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  switch (period) {
    case 'week': {
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      return `Semana del ${start.getDate()} al ${end.getDate()} de ${months[start.getMonth()]} ${start.getFullYear()}`;
    }
    case 'month': {
      const date = new Date(dateRange.start);
      return `${months[date.getMonth()]} ${date.getFullYear()}`;
    }
    case 'year':
      return `Año ${new Date(dateRange.start).getFullYear()}`;
    case 'custom':
    default: {
      const start = new Date(dateRange.start);
      const end = new Date(dateRange.end);
      return `${start.getDate()} de ${months[start.getMonth()]} al ${end.getDate()} de ${months[end.getMonth()]} ${end.getFullYear()}`;
    }
  }
}

// Funciones auxiliares
function calculateChange(current, previous) {
  if (previous === 0) return 0;
  return ((current - previous) / previous * 100).toFixed(1) + '%';
}

function addKPISection(doc, title, value, previousValue) {
  const safeValue = (typeof value === 'number') ? value : 0;
  const safePrevious = (typeof previousValue === 'number') ? previousValue : 0;
  const change = calculateChange(safeValue, safePrevious);
  doc.text(`${title}: $${safeValue.toLocaleString()}`)
     .text(`Cambio vs período anterior: ${change}`, { indent: 20 })
     .moveDown(0.5);
}

function addDetailedSection(doc, data) {
  // Implementar sección detallada...
}

function addChartsSection(doc, data) {
  // Implementar sección de gráficas...
}

function calculatePercentageChange(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

module.exports = {
  generateReport,
  generateFinancialReport,
  calculateDateRange,
  generatePDFReport,
  generateExcelReport
};
