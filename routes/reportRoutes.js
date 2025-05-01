// backend/server/src/routes/reportRoutes.js
const express = require('express');
const router = express.Router();
const Tienda = require('../models/Tienda'); // Asegúrate de tener el modelo correcto para Tienda
const authMiddleware = require('../middlewares/auth');
const User = require('../models/User');
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Inventory = require('../models/Inventory');
const Client = require('../models/Client'); // Asegúrate de tener el modelo correcto para Client
const Movement = require('../models/Movement');
const {generateReport,
  generateFinancialReport,
  calculateDateRange,
  generatePDFReport,
  generateExcelReport} = require('../services/reportGenerators'); // Asegúrate de tener el servicio correcto para generar reportes

// GET /api/reports/clubs — devuelve lista de clubs para filtros
router.get('/clubs', authMiddleware, async (req, res) => {
    try {
      // Obtener el usuario usando el ID inyectado en req.userId
      const owner = await User.findById(req.userId);
      console.log("ID del dueño: ", owner._id);
  
      if (!owner) {
        return res.status(401).json({ message: "No autorizado" });
      }
      
      // Verificar si el dueño tiene clubs registrados
      if (!owner.clubs || owner.clubs.length === 0) {
        return res.status(404).json({ message: "No se encontraron clubs registrados para este usuario" });
      }
      
      // Consultar la colección Tienda usando los clubs registrados del dueño
      const clubs = await Tienda.find({
        _id: { $in: owner.clubs },
        duenoId: owner._id
      }).select('_id nombre');
      
      return res.json({ clubs });
    } catch (error) {
      console.error("Error al obtener los clubs: ", error);
      return res.status(500).json({ message: "Error al obtener clubs" });
    }
});

const getWeekDates = (date) => {
  const current = new Date(date);
  
  // Obtener el lunes (primer día de la semana)
  const first = current.getDate() - current.getDay() + (current.getDay() === 0 ? -6 : 1);
  const firstday = new Date(current);
  firstday.setDate(first);
  firstday.setHours(0, 0, 0, 0);

  // Obtener el domingo (último día de la semana)
  const lastday = new Date(firstday);
  lastday.setDate(firstday.getDate() + 6);
  lastday.setHours(23, 59, 59, 999);

  return { firstday, lastday };
};

const getPreviousPeriodDates = (period, currentStart, currentEnd) => {
  const previousStart = new Date(currentStart);
  const previousEnd = new Date(currentEnd);

  switch (period) {
    case 'week':
      const prevWeek = getWeekDates(new Date(currentStart.setDate(currentStart.getDate() - 7)));
      return {
        previousStart: prevWeek.firstday,
        previousEnd: prevWeek.lastday
      };
    case 'month':
      previousStart.setMonth(previousStart.getMonth() - 1);
      previousEnd.setMonth(previousEnd.getMonth() - 1);
      break;
    case 'year':
      previousStart.setFullYear(previousStart.getFullYear() - 1);
      previousEnd.setFullYear(previousEnd.getFullYear() - 1);
      break;
    case 'custom':
      const rangeDays = Math.ceil((currentEnd.getTime() - currentStart.getTime()) / (1000 * 60 * 60 * 24));
      previousStart.setDate(previousStart.getDate() - rangeDays);
      previousEnd.setDate(currentStart.getDate() - 1);
      break;
  }

  return { previousStart, previousEnd };
};

const getPeriodDates = (period, startDate, endDate) => {
  const now = new Date();
  let start, end;

  switch (period) {
    case 'week':
      const weekDates = getWeekDates(now);
      start = weekDates.firstday;
      end = weekDates.lastday;
      console.log('Week Dates:', weekDates);
      console.log('Start:', start);
      console.log('End:', end);
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    case 'custom':
      if (startDate && endDate) {
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
      } else {
        // Si no hay fechas personalizadas, usar el mes actual como fallback
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      }
      break;
    default:
      // Usar el mes actual como fallback
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  return { start, end };
};

router.get('/financial', authMiddleware, async (req, res) => {
    try {
      const { clubId, period, startDate, endDate } = req.query;
      const userId = req.userId;
  
      // Obtener los clubs del usuario
      const owner = await User.findById(userId);
      if (!owner || !owner.clubs || owner.clubs.length === 0) {
        return res.status(404).json({ message: 'No se encontraron clubs para este usuario' });
      }
  
      // Determinar rango de fechas
      const now = new Date();
    let start, end;

    switch (period) {
      case 'week':
        const weekDates = getWeekDates(now);
        console.log('Week Dates:', weekDates);
        start = weekDates.firstday;
        end = weekDates.lastday;
        break;
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
        break;
      case 'custom':
        start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    const { previousStart, previousEnd } = getPreviousPeriodDates(period, new Date(start), new Date(end));
  
      // Construir el filtro de clubs
      const clubFilter = clubId && clubId !== 'all' 
        ? { clubId: new mongoose.Types.ObjectId(clubId) }
        : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

      console.log('Club Filter:', clubFilter);
      console.log('Date Range:', { start, end });
  
      // Consultar ventas y gastos
      const [salesData, expensesData, salesByDate, expensesByDate, categorySales, categoryExpenses] = await Promise.all([
        // Ventas totales y período anterior
        Sale.aggregate([
          { 
            $match: { 
              ...clubFilter,
              created_at: { $gte: start, $lte: end },
              status: 'completed'
            } 
          },
          { 
            $group: { 
              _id: null,
              total: { $sum: '$total' },
              previousTotal: {
                $sum: {
                  $cond: [
                    { 
                      $and: [
                        { $gte: ['$created_at', previousStart] },
                        { $lt: ['$created_at', previousEnd] }
                      ]
                    },
                    '$total',
                    0
                  ]
                }
              }
            } 
          }
        ]),
  
        // Gastos totales y período anterior
        Expense.aggregate([
          { 
            $match: { 
              ...clubFilter,
              date: { $gte: start, $lte: end }
            } 
          },
          { 
            $group: { 
              _id: null,
              total: { $sum: '$amount' },
              previousTotal: {
                $sum: {
                  $cond: [
                    { 
                      $and: [
                        { $gte: ['$created_at', previousStart] },
                        { $lt: ['$created_at', previousEnd] }
                      ]
                    },
                    '$amount',
                    0
                  ]
                }
              }
            } 
          }
        ]),
  
        // Tendencia mensual de ventas
        Sale.aggregate([
          {
            $match: {
              ...clubFilter,
              created_at: { $gte: start, $lte: end },
              status: 'completed'
            }
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$created_at" }
              },
              sales: { $sum: "$total" }
            }
          },
          { $sort: { "_id": 1 } }
        ]),
        
        // Tendencia de gastos por fecha
        Expense.aggregate([
          {
            $match: {
              ...clubFilter,
              date: { $gte: start, $lte: end }
            }
          },
          {
            $group: {
              _id: {
                $dateToString: { format: "%Y-%m-%d", date: "$date" }
              },
              expenses: { $sum: "$amount" }
            }
          },
          { $sort: { "_id": 1 } }
        ]),
  
        // Desglose por categoría de ventas
        Sale.aggregate([
          {
            $match: {
              ...clubFilter,
              created_at: { $gte: start, $lte: end },
              status: 'completed'
            }
          },
          {
            $unwind: '$itemGroups'
          },
          {
            $group: {
              _id: '$itemGroups.name',
              amount: { $sum: '$total' },
              previousAmount: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$created_at', previousStart] },
                        { $lt: ['$created_at', previousEnd] }
                      ]
                    },
                    '$total',
                    0
                  ]
                }
              }
            }
          }
        ]),
  
        // Desglose por categoría de gastos
        Expense.aggregate([
          {
            $match: {
              ...clubFilter,
              date: { $gte: start, $lte: end }
            }
          },
          {
            $group: {
              _id: '$category',
              amount: { $sum: '$amount' },
              previousAmount: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gte: ['$created_at', previousStart] },
                        { $lt: ['$created_at', previousEnd] }
                      ]
                    },
                    '$amount',
                    0
                  ]
                }
              }
            }
          }
        ])
      ]);
  
      // Procesar datos de tendencia mensual
      const generateTrendData = () => {
        const trendData = [];
        const currentDate = new Date(start);
  
        while (currentDate <= end) {
          const dateString = currentDate.toISOString().split('T')[0];
          const salesForDate = salesByDate.find(item => item._id === dateString);
          const expensesForDate = expensesByDate.find(item => item._id === dateString);
  
          trendData.push({
            date: dateString,
            year: currentDate.getFullYear(),
            month: currentDate.getMonth() + 1,
            sales: salesForDate?.sales || 0,
            expenses: expensesForDate?.expenses || 0,
            profit: (salesForDate?.sales || 0) - (expensesForDate?.expenses || 0)
          });
  
          currentDate.setDate(currentDate.getDate() + 1);
        }
  
        return trendData;
      };
      
      const monthlyTrend = generateTrendData();

      console.log('Tendencia mensual:', monthlyTrend);

      function getDaysInRange(start, end) {
        return Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
      }
      
      function isSameDay(date1, date2) {
        return date1.getFullYear() === date2.getFullYear() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getDate() === date2.getDate();
      }
  
      // Procesar desglose por categoría
      const breakdown = [
        ...categorySales.map(item => ({
          category: `Ventas - ${item._id}`,
          amount: item.amount,
          previousAmount: item.previousAmount
        })),
        ...categoryExpenses.map(item => ({
          category: `Gastos - ${item._id || 'Sin categoría'}`,
          amount: -item.amount,
          previousAmount: -item.previousAmount
        }))
      ];

  
      // Preparar respuesta
      res.json({
        totalSales: salesData[0]?.total || 0,
        previousPeriodSales: salesData[0]?.previousTotal || 0,
        operatingExpenses: expensesData[0]?.total || 0,
        previousPeriodExpenses: expensesData[0]?.previousTotal || 0,
        netProfit: (salesData[0]?.total || 0) - (expensesData[0]?.total || 0),
        previousPeriodProfit: (salesData[0]?.previousTotal || 0) - (expensesData[0]?.previousTotal || 0),
        monthlyTrend,
        breakdown,
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString(),
          period
        }
      });
  
    } catch (error) {
      console.error('Error en reporte financiero:', error);
      res.status(500).json({ message: 'Error al generar el reporte financiero' });
    }
  });


// Agregar esta nueva ruta en reportRoutes.js
router.get('/sales-trend', authMiddleware, async (req, res) => {
  try {
    const { clubId, period } = req.query;
    const userId = req.userId;

    // Validar parámetros
    if (!clubId || !period) {
      return res.status(400).json({ message: "clubId y period son requeridos" });
    }

    // Obtener los clubs del usuario
    const owner = await User.findById(userId);
    if (!owner || !owner.clubs || owner.clubs.length === 0) {
      return res.status(404).json({ message: 'No se encontraron clubs para este usuario' });
    }

    let salesGroupBy = {};
    let expensesGroupBy = {};
    let dateRange = {};
    const now = new Date();

    // Construir el filtro de clubs
    const clubFilter = clubId && clubId !== 'all'
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    // Configurar rangos de fecha y agrupación según el período
    switch (period) {
      case 'week':
        // Calcular el inicio de la semana (lunes)
        const dayOfWeek = now.getDay();
        const diffToMonday = (dayOfWeek + 6) % 7;
        
        const monday = new Date(now);
        monday.setDate(now.getDate() - diffToMonday);
        monday.setHours(0, 0, 0, 0);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        
        dateRange = { $gte: monday, $lte: sunday };
        salesGroupBy = { 
          day: { 
            $dayOfWeek: {
              date: "$created_at",
              timezone: "America/Mexico_City"
            }
          } 
        };
        expensesGroupBy = { 
          day: { 
            $dayOfWeek: {
              date: "$date",
              timezone: "America/Mexico_City"
            }
          } 
        };
        break;

      case 'month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        dateRange = { $gte: startOfMonth, $lte: endOfMonth };
        
        // Cambiar la agrupación para usar número de semana del mes
        salesGroupBy = { 
          weekNum: { 
            $ceil: { 
              $divide: [{ $dayOfMonth: "$created_at" }, 7] 
            } 
          } 
        };
        expensesGroupBy = { 
          weekNum: { 
            $ceil: { 
              $divide: [{ $dayOfMonth: "$date" }, 7] 
            } 
          } 
        };
        break;

      case 'year':
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        dateRange = { $gte: startOfYear, $lte: endOfYear };
        salesGroupBy = { month: { $month: "$created_at" } };
        expensesGroupBy = { month: { $month: "$date" } };
        break;

      case 'custom':
        const start = new Date(req.query.startDate);
        const end = new Date(req.query.endDate);
        dateRange = { $gte: start, $lte: end };
        
        // Determinar agrupación basada en el rango
        const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 31) {
          salesGroupBy = { 
            day: { 
              $dayOfWeek: {
                date: "$created_at",
                timezone: "America/Mexico_City"
              }
            } 
          };
          expensesGroupBy = { 
            day: { 
              $dayOfWeek: {
                date: "$date",
                timezone: "America/Mexico_City"
              }
            } 
          };
        } else {
          salesGroupBy = { month: { $month: "$created_at" } };
          expensesGroupBy = { month: { $month: "$date" } };
        }
        break;

      default:
        return res.status(400).json({ message: "Periodo inválido" });
    }

    // Realizar agregaciones
    const [salesAggregation, expensesAggregation] = await Promise.all([
      Sale.aggregate([
        { 
          $match: { 
            ...clubFilter, 
            created_at: dateRange,
            status: 'completed'
          } 
        },
        { $group: { _id: salesGroupBy, totalSales: { $sum: "$total" } } }
      ]),
      Expense.aggregate([
        { 
          $match: { 
            ...clubFilter, 
            date: dateRange 
          } 
        },
        { $group: { _id: expensesGroupBy, totalExpenses: { $sum: "$amount" } } }
      ])
    ]);

    // Combinar resultados
    const map = {};

    // Procesar ventas y gastos
    const processData = (aggregation, isExpense = false) => {
      aggregation.forEach(item => {
        let key;
        if (period === 'week') {
          const dayNum = item._id.day;
          const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
          key = dayNames[dayNum - 1];
        } else if (period === 'month') {
          // Usar número de semana directamente
          const weekNum = item._id.weekNum;
          key = `Semana ${weekNum}`;
        } else if (period === 'year' || (period === 'custom' && daysDiff > 31)) {
          const monthNum = item._id.month;
          const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", 
                            "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
          key = monthNames[monthNum - 1];
        }

        if (!map[key]) {
          map[key] = { sales: 0, expenses: 0 };
        }
        
        if (isExpense) {
          map[key].expenses = item.totalExpenses;
        } else {
          map[key].sales = item.totalSales;
        }
      });
    };

    processData(salesAggregation);
    processData(expensesAggregation, true);

    // Crear array ordenado según el período
    let result = [];
    if (period === 'week') {
      const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
      result = dayOrder.map(day => ({
        name: day,
        sales: map[day]?.sales || 0,
        expenses: map[day]?.expenses || 0,
        profit: (map[day]?.sales || 0) - (map[day]?.expenses || 0)
      }));
    } else if (period === 'month') {
      for (let i = 1; i <= 5; i++) {
        const key = `Semana ${i}`;
        if (map[key]) {
          result.push({
            name: key,
            sales: map[key].sales,
            expenses: map[key].expenses,
            profit: map[key].sales - map[key].expenses
          });
        }
      }
    } else if (period === 'year') {
      const monthOrder = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                         "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
      result = monthOrder.map(month => ({
        name: month,
        sales: map[month]?.sales || 0,
        expenses: map[month]?.expenses || 0,
        profit: (map[month]?.sales || 0) - (map[month]?.expenses || 0)
      }));
    }

    console.log('Tendencia de ventas:', result);

    res.json(result);

  } catch (error) {
    console.error('Error en tendencia de ventas:', error);
    res.status(500).json({ message: 'Error al obtener tendencia de ventas' });
  }
});

// Ruta para obtener reporte de productos
router.get('/products', authMiddleware, async (req, res) => {
  try {
    const { clubId, period, startDate, endDate } = req.query;
    const userId = req.userId;

    const owner = await User.findById(userId);
    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }

    // Filtro de club
    const clubFilter = clubId && clubId !== 'all' 
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    // Rangos de fecha
    const { start, end } = getPeriodDates(period, startDate, endDate);

    // Obtener top productos vendidos
    const topProducts = await Sale.aggregate([
      { 
        $match: { 
          ...clubFilter,
          created_at: { $gte: start, $lte: end },
          status: 'completed'
        } 
      },
      { $unwind: '$itemGroups' },
      { $unwind: '$itemGroups.items' },
      {
        $group: {
          _id: '$itemGroups.items.product_id',
          totalSales: { $sum: { $multiply: ['$itemGroups.items.quantity', '$itemGroups.items.unit_price'] } },
          quantity: { $sum: '$itemGroups.items.quantity' },
          type: { $first: '$itemGroups.items.type' }
        }
      },
      { $sort: { totalSales: -1 } },
      { $limit: 5 }  // Cambiado de 10 a 5
    ]);

    // Obtener información adicional de los productos
    const productIds = topProducts.map(p => p._id);
    const productsInfo = await Product.find({ _id: { $in: productIds } });

    // Combinar información
    const enrichedProducts = topProducts.map(product => {
      const info = productsInfo.find(p => p._id.equals(product._id));
      return {
        ...product,
        name: info ? `${info.name}${info.flavor ? ` - ${info.flavor}` : ''}` : 'Producto desconocido',
        cost: info?.purchasePrice || 0,
        price: info?.salePrice || info?.portionPrice || 0
      };
    });

    // Distribución por categoría
    const categoryDistribution = await Product.aggregate([
      { $match: clubFilter },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      }
    ]);

    // Distribución por tipo
    const typeDistribution = await Product.aggregate([
      { $match: clubFilter },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      }
    ]);

    // Agregar limit y skip para paginación
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 7;
    const skip = (page - 1) * limit;

    // Modificar consulta de productos con baja rotación para incluir paginación
    const lowRotationProducts = await Inventory.aggregate([
      { $match: clubFilter },
      {
        $lookup: {
          from: 'products',
          localField: 'product',
          foreignField: '_id',
          as: 'productInfo'
        }
      },
      { $unwind: '$productInfo' },
      {
        $project: {
          name: '$productInfo.name',
          type: '$productInfo.type',
          category: '$productInfo.category',
          stock: {
            $add: [
              { $ifNull: ['$sealed', 0] },
              { $ifNull: ['$preparation.currentPortions', 0] }
            ]
          },
          lastMovement: '$updatedAt'
        }
      },
      { $sort: { lastMovement: 1 } },
      { $skip: skip },
      { $limit: limit }
    ]);

    // Obtener el total de productos para la paginación
    const totalProducts = await Inventory.aggregate([
      { $match: clubFilter },
      { $count: 'total' }
    ]);

    const totalCount = totalProducts.length > 0 ? totalProducts[0].total : 0;

    res.json({
      topProducts: enrichedProducts,
      categoryDistribution,
      typeDistribution,
      lowRotationProducts,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalCount / limit),
        totalItems: totalCount
      }
    });

  } catch (error) {
    console.error('Error en reporte de productos:', error);
    res.status(500).json({ message: 'Error al generar el reporte de productos' });
  }
});

router.get('/expenses', authMiddleware, async (req, res) => {
  try {
    const { clubId, period, startDate, endDate } = req.query;
    const userId = req.userId;

    const owner = await User.findById(userId);
    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }

    // Determinar rango de fechas
    const { start, end } = getPeriodDates(period, startDate, endDate);
    const { previousStart, previousEnd } = getPreviousPeriodDates(period, new Date(start), new Date(end));

    // Filtro de club
    const clubFilter = clubId && clubId !== 'all' 
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    // Obtener gastos totales y por período anterior
    const [currentExpenses, categoryDistribution, topExpenses] = await Promise.all([
      // Total de gastos actuales y anteriores
      Expense.aggregate([
        {
          $match: {
            ...clubFilter,
            date: {
              $gte: previousStart,
              $lte: end
            }
          }
        },
        {
          $group: {
            _id: {
              isPrevious: {
                $cond: [
                  { $lt: ["$date", start] },
                  true,
                  false
                ]
              }
            },
            total: { $sum: "$amount" }
          }
        }
      ]),

      // Distribución por categoría
      Expense.aggregate([
        {
          $match: {
            ...clubFilter,
            date: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: "$category",
            value: { $sum: "$amount" }
          }
        },
        {
          $project: {
            name: "$_id",
            value: 1,
            _id: 0
          }
        }
      ]),

      // Top gastos
      Expense.find({
        ...clubFilter,
        date: { $gte: start, $lte: end }
      })
      .sort({ amount: -1 })
      .limit(5)
      .lean()
    ]);

    const totalExpenses = currentExpenses.find(e => !e._id.isPrevious)?.total || 0;
    const previousTotalExpenses = currentExpenses.find(e => e._id.isPrevious)?.total || 0;

    res.json({
      totalExpenses,
      previousTotalExpenses,
      categoryDistribution,
      topExpenses
    });

  } catch (error) {
    console.error('Error en reporte de gastos:', error);
    res.status(500).json({ message: 'Error al generar el reporte de gastos' });
  }
});

// Agregar esta nueva ruta en reportRoutes.js
router.get('/inventory', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.query;
    const userId = req.userId;

    const owner = await User.findById(userId);
    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }

    // Filtro de club
    const clubFilter = clubId && clubId !== 'all' 
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    // Obtener el usuario y sus preferencias
    const user = await User.findById(userId);
    const inventarioIdeal = user?.preferenciasOperativas?.inventarioIdeal || {
      sealed: 10,
      prepared: 20
    };

    // Obtener todas las consultas necesarias en paralelo
    const [inventorySummary, productTypes, inventoryDetails] = await Promise.all([
      // Resumen del inventario
      Inventory.aggregate([
        { $match: clubFilter },
        {
          $group: {
            _id: null,
            totalProducts: { $sum: 1 },
            lowStock: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $lt: ["$sealed", inventarioIdeal.sealed] },
                      { 
                        $lt: [
                          "$preparation.currentPortions",
                          inventarioIdeal.prepared
                        ]
                      }
                    ]
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),

      // Distribución por tipo de producto
      Product.aggregate([
        { $match: clubFilter },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            totalValue: {
              $sum: "$purchasePrice"
            }
          }
        }
      ]),

      // Detalles del inventario
      Inventory.aggregate([
        { $match: clubFilter },
        {
          $lookup: {
            from: 'products',
            localField: 'product',
            foreignField: '_id',
            as: 'productInfo'
          }
        },
        { $unwind: '$productInfo' },
        {
          $addFields: {
            minStock: {
              sealed: inventarioIdeal.sealed,
              prepared: inventarioIdeal.prepared
            }
          }
        },
        {
          $project: {
            name: '$productInfo.name',
            type: '$productInfo.type',
            sealed: '$sealed',
            preparation: {
              units: '$preparation.units',
              currentPortions: '$preparation.currentPortions',
              portionsPerUnit: '$productInfo.portions'
            },
            minStock: 1,
            cost: '$productInfo.purchasePrice',
            price: {
              $cond: {
                if: { $eq: ['$productInfo.type', 'sealed'] },
                then: '$productInfo.salePrice',
                else: '$productInfo.portionPrice'
              }
            },
            lastMovement: '$updatedAt',
            rotationDays: {
              $divide: [
                { $subtract: [new Date(), '$updatedAt'] },
                1000 * 60 * 60 * 24
              ]
            }
          }
        }
      ])
    ]);

    // Calcular valor total y promedio de rotación
    const totalValue = productTypes.reduce((sum, type) => sum + type.totalValue, 0);
    const averageRotation = Math.round(
      inventoryDetails.reduce((sum, item) => sum + item.rotationDays, 0) / 
      inventoryDetails.length
    );
    console.log('lowStock:', inventorySummary[0]?.lowStock);  

    res.json({
      stats: {
        totalValue,
        totalProducts: inventorySummary[0]?.totalProducts || 0,
        lowStock: inventorySummary[0]?.lowStock || 0,
        averageRotation
      },
      categories: productTypes.map(type => ({
        name: type._id === 'sealed' ? 'Sellados' : 
              type._id === 'prepared' ? 'Preparados' : 'Ambos',
        count: type.count,
        value: type.totalValue
      })),
      products: inventoryDetails
    });

  } catch (error) {
    console.error('Error en reporte de inventario:', error);
    res.status(500).json({ message: 'Error al generar el reporte de inventario' });
  }
});

// Agregar esta nueva función específica para cashflow
const getCashflowDateRange = (date) => {
  const current = new Date(date);
  current.setUTCHours(0, 0, 0, 0);
  
  const firstday = new Date(current);
  const lastday = new Date(current);
  
  if (current.getUTCDay() === 0) { // Si es domingo
    firstday.setUTCDate(current.getUTCDate() - 6); // Ir al lunes anterior
    lastday.setUTCDate(current.getUTCDate()); // Mantener el domingo
  } else {
    firstday.setUTCDate(current.getUTCDate() - current.getUTCDay() + 1); // Ir al lunes
    lastday.setUTCDate(firstday.getUTCDate() + 6); // Ir al domingo
  }
  
  firstday.setUTCHours(0, 0, 0, 0);
  lastday.setUTCHours(23, 59, 59, 999);

  return { firstday, lastday };
};

router.get('/cashflow', authMiddleware, async (req, res) => {
  try {
    const { clubId, month, year, period, date } = req.query;
    const userId = req.userId;

    const owner = await User.findById(userId);
    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }

    // Ajustar fechas según el período
    let startDate, endDate;
    
    if (period === 'week') {
      const weekDates = getCashflowDateRange(date || new Date());
      startDate = weekDates.firstday;
      endDate = weekDates.lastday;
    } else if (period === 'year') {
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    } else {
      // Para vista mensual
      startDate = new Date(Date.UTC(year, month - 1, 1));
      endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    }

    // Ajustar a la zona horaria de México (UTC-6)
    const timeZoneOffset = -6 * 60; // -6 horas en minutos
    startDate = new Date(startDate.getTime() - timeZoneOffset * 60000);
    endDate = new Date(endDate.getTime() - timeZoneOffset * 60000);
 
    // Fechas para comparación con mes anterior
    const prevStartDate = new Date(startDate);
    prevStartDate.setMonth(prevStartDate.getMonth() - 1);
    const prevEndDate = new Date(endDate);
    prevEndDate.setMonth(prevEndDate.getMonth() - 1);

    // Filtro de club
    const clubFilter = clubId && clubId !== 'all' 
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    // Obtener ventas y gastos con conteo de transacciones
    const [salesByDay, expensesByDay, prevSales, prevExpenses] = await Promise.all([
      Sale.aggregate([
        {
          $match: {
            ...clubFilter,
            created_at: { $gte: startDate, $lte: endDate },
            status: 'completed'
          }
        },
        {
          $addFields: {
            dateInMexicoCity: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$created_at",
                timezone: "America/Mexico_City"
              }
            }
          }
        },
        {
          $group: {
            _id: "$dateInMexicoCity",
            inflow: { $sum: "$total" },
            transactionCount: { $sum: 1 }
          }
        },
        { $sort: { "_id": 1 } }
      ]),
      Expense.aggregate([
        {
          $match: {
            ...clubFilter,
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $addFields: {
            dateInMexicoCity: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$date",
                timezone: "America/Mexico_City"
              }
            }
          }
        },
        {
          $group: {
            _id: "$dateInMexicoCity",
            outflow: { $sum: "$amount" },
            transactionCount: { $sum: 1 }
          }
        },
        { $sort: { "_id": 1 } }
      ]),
      // Obtener totales del mes anterior
      Sale.aggregate([
        {
          $match: {
            ...clubFilter,
            created_at: { $gte: prevStartDate, $lte: prevEndDate },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$total" }
          }
        }
      ]),
      Expense.aggregate([
        {
          $match: {
            ...clubFilter,
            date: { $gte: prevStartDate, $lte: prevEndDate }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: "$amount" }
          }
        }
      ])
    ]);

    // Generar array con todos los días del período
    const cashFlowMap = new Map();
    let currentDate = new Date(startDate);
    let totalInflow = 0;
    let totalOutflow = 0;

    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      cashFlowMap.set(dateStr, {
        date: dateStr,
        inflow: 0,
        outflow: 0,
        balance: 0,
        inflowCount: 0,
        outflowCount: 0,
        hasData: false
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Procesar ventas y gastos con sus conteos
    salesByDay.forEach(sale => {
      const day = cashFlowMap.get(sale._id);
      if (day) {
        day.inflow = sale.inflow;
        day.inflowCount = sale.transactionCount;
        day.hasData = true;
        totalInflow += sale.inflow;
      }
    });

    expensesByDay.forEach(expense => {
      const day = cashFlowMap.get(expense._id);
      if (day) {
        day.outflow = expense.outflow;
        day.outflowCount = expense.transactionCount;
        day.hasData = true;
        totalOutflow += expense.outflow;
      }
    });

    // Calcular balance para cada día
    let runningBalance = 0;
    const cashFlowData = Array.from(cashFlowMap.values()).map(day => {
      runningBalance += (day.inflow - day.outflow);
      return {
        ...day,
        balance: runningBalance
      };
    });

    // Calcular porcentajes de cambio
    const prevMonthInflow = prevSales[0]?.total || 0;
    const prevMonthOutflow = prevExpenses[0]?.total || 0;
    
    const inflowChange = prevMonthInflow ? ((totalInflow - prevMonthInflow) / prevMonthInflow) * 100 : 0;
    const outflowChange = prevMonthOutflow ? ((totalOutflow - prevMonthOutflow) / prevMonthOutflow) * 100 : 0;

    // Modificar la respuesta para incluir el período
    console.log('Período:', period);
    console.log('Rango de fechas:', { startDate, endDate });
    res.json({
      cashFlowData,
      summary: {
        totalInflow,
        totalOutflow,
        netCashFlow: totalInflow - totalOutflow,
        inflowChange,
        outflowChange
      },
      period,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      }
    });

  } catch (error) {
    console.error('Error en reporte de flujo de caja:', error);
    res.status(500).json({ message: 'Error al generar el reporte de flujo de caja' });
  }
});

router.get('/customer-activity', authMiddleware, async (req, res) => {
  try {
    const { clubId, period, startDate, endDate } = req.query;
    const userId = req.userId;

    const owner = await User.findById(userId);
    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }

    const clubFilter = clubId && clubId !== 'all' 
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    const { start, end } = getPeriodDates(period, startDate, endDate);

    // Obtener todos los clientes primero
    const clients = await Client.find(clubFilter);
    
    // Obtener estadísticas de ventas por cliente
    const [salesStats, customerTrend, topCustomers] = await Promise.all([
      // Estadísticas generales y métricas adicionales
      Sale.aggregate([
        { 
          $match: { 
            ...clubFilter,
            created_at: { $gte: start, $lte: end },
            client: { $exists: true }
          } 
        },
        {
          $group: {
            _id: null,
            totalSales: { $sum: '$total' },
            uniqueCustomers: { $addToSet: '$client' },
            totalTransactions: { $sum: 1 },
            averageTicket: { $avg: '$total' }
          }
        }
      ]),

      // Tendencia mensual - Generar todos los meses del año
      (async () => {
        const months = [];
        const currentYear = new Date().getFullYear();
        
        // Crear array con todos los meses
        for (let month = 0; month < 12; month++) {
          const monthStart = new Date(currentYear, month, 1);
          const monthEnd = new Date(currentYear, month + 1, 0);

          const customersWithPurchases = await Sale.distinct('client', {
            ...clubFilter,
            created_at: {
              $gte: monthStart,
              $lte: monthEnd
            }
          });

          const newCustomers = await Client.countDocuments({
            ...clubFilter,
            createdAt: {
              $gte: monthStart,
              $lte: monthEnd
            }
          });

          months.push({
            month: month + 1,
            year: currentYear,
            active: customersWithPurchases.length,
            new: newCustomers
          });
        }
        return months;
      })(),

      // Top clientes con más compras
      Sale.aggregate([
        { 
          $match: { 
            ...clubFilter,
            created_at: { $gte: start, $lte: end },
            client: { $exists: true }
          }
        },
        {
          $group: {
            _id: '$client',
            totalSpent: { $sum: '$total' },
            purchaseCount: { $sum: 1 },
            lastPurchase: { $max: '$created_at' },
            averageTicket: { $avg: '$total' }
          }
        },
        {
          $lookup: {
            from: 'clients',
            localField: '_id',
            foreignField: '_id',
            as: 'clientInfo'
          }
        },
        { $unwind: '$clientInfo' },
        {
          $project: {
            _id: 1,
            name: '$clientInfo.name',
            type: '$clientInfo.type',
            email: '$clientInfo.email',
            phone: '$clientInfo.phone',
            lastPurchase: 1,
            totalSpent: 1,
            purchaseCount: 1,
            averageTicket: 1,
            status: {
              $cond: [
                { $gte: ['$lastPurchase', new Date(new Date().setDate(new Date().getDate() - 30))] },
                'active',
                'inactive'
              ]
            }
          }
        },
        { $sort: { totalSpent: -1 } },
        { $limit: 10 }
      ])
    ]);

    // Procesar y enriquecer datos de clientes
    const enrichedClients = clients.map(client => {
      const salesData = topCustomers.find(c => c._id.equals(client._id)) || {
        totalSpent: 0,
        purchaseCount: 0,
        status: 'sin_compras',
        lastPurchase: null,
        averageTicket: 0
      };

      return {
        _id: client._id,
        name: client.name,
        type: client.type,
        email: client.email,
        phone: client.phone,
        createdAt: client.createdAt,
        ...salesData
      };
    });

    // Calcular métricas adicionales
    const stats = {
      totalCustomers: clients.length,
      newCustomers: clients.filter(c => 
        c.createdAt >= start && c.createdAt <= end
      ).length,
      totalSales: salesStats[0]?.totalSales || 0,
      averageTicket: salesStats[0]?.averageTicket || 0,
      purchaseFrequency: salesStats[0]?.totalTransactions 
        ? salesStats[0].totalTransactions / salesStats[0].uniqueCustomers.length 
        : 0
    };

    res.json({
      stats,
      trend: customerTrend,
      topCustomers: enrichedClients
        .sort((a, b) => b.totalSpent - a.totalSpent)
        .slice(0, 10)
    });

  } catch (error) {
    console.error('Error en reporte de actividad de clientes:', error);
    res.status(500).json({ message: 'Error al generar el reporte de actividad de clientes' });
  }
});

router.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const { 
      clubId, 
      period, 
      startDate, 
      endDate, 
      page = 1, 
      limit = 10, 
      tipo, 
      busqueda,
      responsable,
      montoMin,
      montoMax,
      estado
    } = req.query;
    
    const userId = req.userId;
    const owner = await User.findById(userId);
    if (!owner) {
      return res.status(401).json({ message: "No autorizado" });
    }

    const { start, end } = getPeriodDates(period, startDate, endDate);
    
    // 1. Definir clubFilter antes de usarlo
    const clubFilter = clubId && clubId !== 'all' 
      ? { clubId: new mongoose.Types.ObjectId(clubId) }
      : { clubId: { $in: owner.clubs.map(id => new mongoose.Types.ObjectId(id)) } };

    // 2. Inicializar el array de queries
    const queries = [];

    // 3. Construir los filtros base
    const ventasMatch = {
      ...clubFilter,
      created_at: { $gte: start, $lte: end },
      status: 'completed'
    };

    const gastosMatch = {
      ...clubFilter,
      date: { $gte: start, $lte: end }
    };

    // 4. Agregar filtros adicionales
    if (busqueda) {
      ventasMatch.$or = [
        { 'itemGroups.name': { $regex: busqueda, $options: 'i' } },
        { 'itemGroups.items.product_id': { 
          $in: await Product.find({ 
            name: { $regex: busqueda, $options: 'i' } 
          }).distinct('_id')
        }}
      ];
      gastosMatch.description = { $regex: busqueda, $options: 'i' };
    }

    if (montoMin) {
      ventasMatch.total = { $gte: parseFloat(montoMin) };
      gastosMatch.amount = { $gte: parseFloat(montoMin) };
    }

    if (montoMax) {
      if (ventasMatch.total) {
        ventasMatch.total.$lte = parseFloat(montoMax);
      } else {
        ventasMatch.total = { $lte: parseFloat(montoMax) };
      }
      
      if (gastosMatch.amount) {
        gastosMatch.amount.$lte = parseFloat(montoMax);
      } else {
        gastosMatch.amount = { $lte: parseFloat(montoMax) };
      }
    }

    // 5. Agregar queries según el tipo
    if (!tipo || tipo === 'todos' || tipo === 'venta') {
      queries.push(
        Sale.aggregate([
          { $match: ventasMatch },
          { 
            $lookup: {
              from: 'users',
              localField: 'employee',
              foreignField: '_id',
              as: 'employeeInfo'
            }
          },
          { $unwind: '$employeeInfo' },
          {
            $match: responsable ? {
              'employeeInfo.nombre': { $regex: responsable, $options: 'i' }
            } : {}
          },
          // Nuevo: Expandir los itemGroups y hacer lookup a products
          {
            $addFields: {
              itemGroups: {
                $map: {
                  input: '$itemGroups',
                  as: 'group',
                  in: {
                    name: '$$group.name',
                    items: {
                      $map: {
                        input: '$$group.items',
                        as: 'item',
                        in: {
                          productId: '$$item.product_id',
                          quantity: '$$item.quantity',
                          unit_price: '$$item.unit_price',
                          subtotal: { $multiply: ['$$item.quantity', '$$item.unit_price'] }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          {
            $lookup: {
              from: 'products',
              let: { items: '$itemGroups' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $in: ['$_id', {
                        $reduce: {
                          input: '$$items',
                          initialValue: [],
                          in: {
                            $concatArrays: [
                              '$$value',
                              {
                                $map: {
                                  input: '$$this.items',
                                  as: 'item',
                                  in: '$$item.productId'
                                }
                              }
                            ]
                          }
                        }
                      }]
                    }
                  }
                }
              ],
              as: 'productsInfo'
            }
          },
          {
            $addFields: {
              itemGroups: {
                $map: {
                  input: '$itemGroups',
                  as: 'group',
                  in: {
                    name: '$$group.name',
                    items: {
                      $map: {
                        input: '$$group.items',
                        as: 'item',
                        in: {
                          $mergeObjects: [
                            '$$item',
                            {
                              name: {
                                $let: {
                                  vars: {
                                    product: {
                                      $arrayElemAt: [
                                        {
                                          $filter: {
                                            input: '$productsInfo',
                                            cond: { $eq: ['$$this._id', '$$item.productId'] }
                                          }
                                        },
                                        0
                                      ]
                                    }
                                  },
                                  in: '$$product.name'
                                }
                              }
                            }
                          ]
                        }
                      }
                    },
                    subtotal: {
                      $sum: {
                        $map: {
                          input: '$$group.items',
                          as: 'item',
                          in: { $multiply: ['$$item.quantity', '$$item.unit_price'] }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          {
            $project: {
              fecha: '$created_at',
              tipo: 'venta',
              descripcion: 'Da click para ver más detalles',
              monto: '$total',
              itemGroups: 1,
              responsable: {
                nombre: '$employeeInfo.nombre',
                _id: '$employeeInfo._id'
              },
              estado: 1
            }
          }
        ])
      );
    }

    if (!tipo || tipo === 'todos' || tipo === 'gasto') {
      queries.push(
        Expense.aggregate([
          { $match: gastosMatch },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo'
            }
          },
          { $unwind: '$userInfo' },
          {
            $match: responsable ? {
              'userInfo.nombre': { $regex: responsable, $options: 'i' }
            } : {}
          },
          {
            $project: {
              fecha: '$date',
              tipo: 'gasto',
              descripcion: '$description',
              monto: { $multiply: ['$amount', -1] },
              responsable: {
                nombre: '$userInfo.nombre',
                _id: '$userInfo._id'
              },
              estado: 'completado'
            }
          }
        ])
      );
    }

    // Agregar query para ajustes si corresponde
    if (!tipo || tipo === 'todos' || tipo === 'ajuste') {
      queries.push(
        Movement.aggregate([
          { 
            $match: {
              ...clubFilter,
              date: { $gte: start, $lte: end },
              type: 'ajuste'
            }
          },
          {
            $lookup: {
              from: 'users',
              localField: 'user',
              foreignField: '_id',
              as: 'userInfo'
            }
          },
          { $unwind: '$userInfo' },
          {
            $match: responsable ? {
              'userInfo.nombre': { $regex: responsable, $options: 'i' }
            } : {}
          },
          {
            $lookup: {
              from: 'products',
              localField: 'product',
              foreignField: '_id',
              as: 'productInfo'
            }
          },
          { $unwind: '$productInfo' },
          {
            $project: {
              fecha: '$date',
              tipo: 'ajuste',
              motivo: '$description',
              descripcion: '$description',
              monto: { 
                $multiply: ['$quantity', '$productInfo.purchasePrice'] 
              },
              productos: [{
                nombre: '$productInfo.name',
                cantidad: '$quantity',
                tipo: '$unit'
              }],
              responsable: {
                nombre: '$userInfo.nombre',
                _id: '$userInfo._id'
              },
              estado: 'completado'
            }
          }
        ])
      );
    }

    // 6. Ejecutar queries y aplicar paginación
    const results = await Promise.all(queries);
    const todosLosMovimientos = results
      .flat()
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    const total = todosLosMovimientos.length;
    const totalPaginas = Math.ceil(total / 10);
    const skip = (page - 1) * 10;
    const movimientos = todosLosMovimientos.slice(skip, skip + 10);

    res.json({
      movimientos,
      paginacion: {
        total,
        totalPaginas,
        paginaActual: parseInt(page),
        porPagina: 10
      }
    });

  } catch (error) {
    console.error('Error en historial de movimientos:', error);
    res.status(500).json({ message: 'Error al obtener historial de movimientos' });
  }
});

router.get('/club-performance', authMiddleware, async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;
    const userId = req.userId;

    const owner = await User.findById(userId);
    if (!owner || !owner.clubs || owner.clubs.length === 0) {
      return res.status(404).json({ message: 'No se encontraron clubs' });
    }

    const { start, end } = getPeriodDates(period, startDate, endDate);
    const { previousStart, previousEnd } = getPreviousPeriodDates(period, new Date(start), new Date(end));

    // Obtener datos de todos los clubs del usuario
    const clubsData = await Promise.all(owner.clubs.map(async (clubId) => {
      const club = await Tienda.findById(clubId);
      if (!club) return null;

      const [currentSales, previousSales, currentExpenses, previousExpenses, employeesCount, clientsCount, topProducts] = await Promise.all([
        // Ventas actuales
        Sale.aggregate([
          { 
            $match: { 
              clubId,
              created_at: { $gte: start, $lte: end },
              status: 'completed'
            }
          },
          { $group: { _id: null, total: { $sum: '$total' } } }
        ]),
        // Ventas anteriores
        Sale.aggregate([
          {
            $match: {
              clubId,
              created_at: { $gte: previousStart, $lte: previousEnd },
              status: 'completed'
            }
          },
          { $group: { _id: null, total: { $sum: '$total' } } }
        ]),
        // Gastos actuales
        Expense.aggregate([
          {
            $match: {
              clubId,
              date: { $gte: start, $lte: end }
            }
          },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        // Gastos anteriores
        Expense.aggregate([
          {
            $match: {
              clubId,
              date: { $gte: previousStart, $lte: previousEnd }
            }
          },
          { $group: { _id: null, total: { $sum: '$amount' } } }
        ]),
        User.countDocuments({ clubs: clubId }),
        Client.countDocuments({ clubId }),
        // Top productos como una consulta independiente
        Sale.aggregate([
          {
            $match: {
              clubId,
              created_at: { $gte: start, $lte: end },
              status: 'completed'
            }
          },
          { $unwind: '$itemGroups' },
          { $unwind: '$itemGroups.items' },
          {
            $group: {
              _id: '$itemGroups.items.product_id',
              sales: { $sum: '$itemGroups.items.quantity' },
              totalSales: { $sum: { $multiply: ['$itemGroups.items.quantity', '$itemGroups.items.unit_price'] } }
            }
          },
          {
            $lookup: {
              from: 'products',
              localField: '_id',
              foreignField: '_id',
              as: 'productInfo'
            }
          },
          { $unwind: '$productInfo' },
          {
            $project: {
              name: '$productInfo.name',
              sales: 1,
              profit: {
                $multiply: [
                  '$sales',
                  { $subtract: ['$itemGroups.items.unit_price', '$productInfo.purchasePrice'] }
                ]
              }
            }
          },
          { $sort: { sales: -1 } },
          { $limit: 3 }
        ])
      ]);

      // Cálculo de ganancias actual y anterior
      const currentTotalSales = currentSales[0]?.total || 0;
      const currentTotalExpenses = currentExpenses[0]?.total || 0;
      const previousTotalSales = previousSales[0]?.total || 0;
      const previousTotalExpenses = previousExpenses[0]?.total || 0;

      return {
        id: club._id.toString(),
        name: club.nombre,
        image: club.image || 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48',
        totalSales: currentTotalSales,
        totalProfit: currentTotalSales - currentTotalExpenses,
        employeesCount,
        clientsCount,
        rating: 4.5,
        performance: {
          sales: {
            current: currentTotalSales,
            previous: previousTotalSales
          },
          profit: {
            current: currentTotalSales - currentTotalExpenses,
            previous: previousTotalSales - previousTotalExpenses
          },
          clients: {
            current: clientsCount,
            previous: clientsCount - Math.floor(clientsCount * 0.1)
          }
        },
        topProducts
      };
    }));

    // Filtrar nulls y enviar respuesta
    const validClubs = clubsData.filter(club => club !== null);
    res.json(validClubs);

  } catch (error) {
    console.error('Error en rendimiento de clubs:', error);
    res.status(500).json({ message: 'Error al obtener rendimiento de clubs' });
  }
});

// GET /api/reports/user-info
router.get('/user-info', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('nombre apellido role').lean();
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Asegurar que se envía solo el nombre completo sin undefined
    const nombreCompleto = `${user.nombre || ''} ${user.apellido || ''}`.trim();

    return res.json({
      nombreCompleto,
      role: user.role
    });
  } catch (error) {
    console.error('Error al obtener información del usuario:', error);
    return res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Agregar el endpoint para exportación
router.post('/export', authMiddleware, async (req, res) => {
  try {
    const { 
      reportType,
      format,
      period,
      dateRange,
      clubs,
      includeCharts,
      includeDetails,
      customNotes
    } = req.body;

    console.log('Export Request:', {
      reportType,
      format,
      period,
      dateRange,
      clubs,
      includeCharts,
      includeDetails
    });

    // Get user for report metadata
    const user = await User.findById(req.userId);
    console.log('User Data:', {
      id: user._id,
      nombre: user.nombre,
      apellido: user.apellido,
      role: user.role
    });

    const reportConfig = {
      format,
      user: {
        nombreCompleto: `${user.nombre} ${user.apellido}`,
        role: user.role
      },
      metadata: {
        period,
        dateRange,
        clubs: await getClubNames(clubs),
        reportType
      },
      includeCharts,
      includeDetails,
      customNotes
    };

    // Obtener datos del reporte
    const reportData = await generateFinancialReport(clubs, period, dateRange);
    console.log('Generated Report Data:', {
      totalSales: reportData.financialMetrics?.sales?.total,
      totalExpenses: reportData.financialMetrics?.expenses?.total,
      netProfit: reportData.financialMetrics?.netProfit
    });

    // Generar el reporte en el formato solicitado
    const { buffer, extension, contentType } = await generateReport({
      ...reportConfig,
      reportData
    });

    // Configurar headers para descarga
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 
      `attachment; filename=reporte_${reportType}_${new Date().toISOString().split('T')[0]}.${extension}`);

    return res.send(buffer);

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ message: 'Error al generar el reporte' });
  }
});

// Función auxiliar para obtener nombres de clubs
async function getClubNames(clubIds) {
  const clubs = await Tienda.find({ 
    _id: { $in: clubIds.map(id => new mongoose.Types.ObjectId(id)) } 
  }).select('nombre');
  return clubs.map(c => c.nombre);
}

module.exports = router;
