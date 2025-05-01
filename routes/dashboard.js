// routes/dashboard.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/auth');

// Modelos necesarios
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Inventory = require('../models/Inventory');
const User = require('../models/User');

// GET /api/dashboard/kpis?clubId=...
router.get('/kpis', authMiddleware, async (req, res) => {
  try {
    const { clubId } = req.query;
    if (!clubId) {
      return res.status(400).json({ message: "El clubId es requerido" });
    }

    // Obtener el inventario ideal del usuario
    const user = await User.findById(req.userId);
    const idealStock = user?.inventarioIdeal || 5;

    // Período actual: mes actual
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Período anterior: mes anterior completo
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Consultas paralelas para mejorar rendimiento
    const [salesCurrent, expensesCurrent, salesPrev, expensesPrev, criticalInventory] = await Promise.all([
      Sale.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        created_at: { $gte: startOfMonth, $lte: endOfMonth }
      }),
      Expense.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        date: { $gte: startOfMonth, $lte: endOfMonth }
      }),
      Sale.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        created_at: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      }),
      Expense.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        date: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      }),
      // Consulta mejorada para inventario crítico
      Inventory.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        $or: [
          { sealed: { $lt: idealStock } },
          { 
            'preparation.currentPortions': { $lt: idealStock },
            'preparation.portionsPerUnit': { $gt: 0 } // Solo si maneja porciones
          }
        ]
      }).populate('product', 'name flavor type')
    ]);

    // Debug logs para tendencias
    console.log('Datos para cálculo de tendencias:', {
      salesCurrent: {
        total: salesCurrent.reduce((sum, sale) => sum + sale.total, 0),
        count: salesCurrent.length,
        period: 'Actual',
        dates: salesCurrent.map(s => s.created_at)
      },
      salesPrev: {
        total: salesPrev.reduce((sum, sale) => sum + sale.total, 0),
        count: salesPrev.length,
        period: 'Anterior',
        dates: salesPrev.map(s => s.created_at)
      },
      expensesCurrent: {
        total: expensesCurrent.reduce((sum, exp) => sum + exp.amount, 0),
        count: expensesCurrent.length
      },
      expensesPrev: {
        total: expensesPrev.reduce((sum, exp) => sum + exp.amount, 0),
        count: expensesPrev.length
      },
      dateRanges: {
        current: { start: startOfMonth, end: endOfMonth },
        previous: { start: startOfPrevMonth, end: endOfPrevMonth }
      }
    });

    // Calcular totales
    const salesTotalCurrent = salesCurrent.reduce((sum, sale) => sum + sale.total, 0);
    const expensesTotalCurrent = expensesCurrent.reduce((sum, expense) => sum + expense.amount, 0);
    const salesTotalPrev = salesPrev.reduce((sum, sale) => sum + sale.total, 0);
    const expensesTotalPrev = expensesPrev.reduce((sum, expense) => sum + expense.amount, 0);

    // Calcular ganancias netas
    const netProfitCurrent = salesTotalCurrent - expensesTotalCurrent;
    const netProfitPrev = salesTotalPrev - expensesTotalPrev;

    // Calcular porcentajes de crecimiento
    const calculateGrowth = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number(((current - previous) / previous * 100).toFixed(1));
    };

    // Procesar inventario crítico
    const inventoryItems = criticalInventory
      .filter(item => {
        // Solo incluir items que realmente tengan stock bajo
        const currentStock = item.sealed || item.preparation?.units || 0;
        return currentStock < idealStock;
      })
      .map(item => ({
        name: `${item.product.name}${item.product.flavor ? ` (${item.product.flavor})` : ''}`,
        stock: `${item.sealed || item.preparation?.units || 0} unidades`
      }));

    console.log("Inventario crítico:", inventoryItems);

    res.json({
      salesTotal: salesTotalCurrent,
      expensesTotal: expensesTotalCurrent,
      netProfit: netProfitCurrent,
      salesGrowth: calculateGrowth(salesTotalCurrent, salesTotalPrev),
      netProfitGrowth: calculateGrowth(netProfitCurrent, netProfitPrev),
      inventoryCritical: inventoryItems.length,
      inventoryItems,
      inventoryIdeal: idealStock
    });

  } catch (error) {
    console.error("Error en /api/dashboard/kpis:", error);
    res.status(500).json({ message: error.message || "Error al obtener los KPIs del dashboard" });
  }
});

router.get('/sales-vs-expenses', authMiddleware, async (req, res) => {
    try {
      const { clubId, period } = req.query;
      if (!clubId || !period) {
        return res.status(400).json({ message: "clubId y period son requeridos" });
      }
      
      let salesGroupBy = {};
      let expensesGroupBy = {};
      let dateRange = {};
    
      const now = new Date();
    
      if (period === "weekly") {
        // Ajustar a la zona horaria local (UTC-6 para México)
        const now = new Date();
        const offset = -6; // Offset para México (UTC-6)
        
        // Calcular el inicio de la semana (lunes)
        const dayOfWeek = now.getDay();
        const diffToMonday = (dayOfWeek + 6) % 7;
        
        const monday = new Date(now);
        monday.setDate(now.getDate() - diffToMonday);
        // Establecer a inicio del día en hora local
        monday.setHours(0 - offset, 0, 0, 0);
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        // Establecer a fin del día en hora local
        sunday.setHours(23 - offset, 59, 59, 999);
        
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
      } else if (period === "monthly") {
        // Agrupar por semana del mes: usamos $ceil($divide(dayOfMonth, 7))
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        dateRange = { $gte: startOfMonth, $lte: endOfMonth };
        salesGroupBy = { week: { $ceil: { $divide: [{ $dayOfMonth: "$created_at" }, 7] } } };
        expensesGroupBy = { week: { $ceil: { $divide: [{ $dayOfMonth: "$date" }, 7] } } };
      } else if (period === "annual") {
        // Agrupar por mes
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        dateRange = { $gte: startOfYear, $lte: endOfYear };
        salesGroupBy = { month: { $month: "$created_at" } };
        expensesGroupBy = { month: { $month: "$date" } };
      } else {
        return res.status(400).json({ message: "Periodo inválido" });
      }
    
      // Agregar ventas
      const salesAggregation = await Sale.aggregate([
        { $match: { clubId: new mongoose.Types.ObjectId(clubId), created_at: dateRange } },
        { $group: { _id: salesGroupBy, totalSales: { $sum: "$total" } } }
      ]);
    
      // Agregar gastos
      const expensesAggregation = await Expense.aggregate([
        { $match: { clubId: new mongoose.Types.ObjectId(clubId), date: dateRange } },
        { $group: { _id: expensesGroupBy, totalExpenses: { $sum: "$amount" } } }
      ]);

      console.log("Sales Aggregation:", salesAggregation);
    
      // Combinar resultados en un mapa
      const map = {};
    
      // Procesar ventas
      salesAggregation.forEach(item => {
        let key;
        if (period === "weekly") {
          const dayNum = item._id.day;
          const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
          // Queremos mostrar de lunes a domingo:
          key = dayNames[dayNum - 1];
        } else if (period === "monthly") {
          const weekNum = item._id.week;
          key = `Semana ${weekNum}`;
        } else if (period === "annual") {
          const monthNum = item._id.month;
          const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
          key = monthNames[monthNum - 1];
        }
        map[key] = { sales: item.totalSales, expenses: 0 };
      });
    
      // Procesar gastos
      expensesAggregation.forEach(item => {
        let key;
        if (period === "weekly") {
          const dayNum = item._id.day;
          const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
          key = dayNames[dayNum - 1];
        } else if (period === "monthly") {
          const weekNum = item._id.week;
          key = `Semana ${weekNum}`;
        } else if (period === "annual") {
          const monthNum = item._id.month;
          const monthNames = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
          key = monthNames[monthNum - 1];
        }
        if (map[key]) {
          map[key].expenses = item.totalExpenses;
        } else {
          map[key] = { sales: 0, expenses: item.totalExpenses };
        }
      });
    
      // Convertir el mapa a arreglo ordenado según el período
      let result = [];
      if (period === "weekly") {
        const dayOrder = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
        result = dayOrder.map(day => ({
          name: day,
          sales: map[day]?.sales || 0,
          expenses: map[day]?.expenses || 0
        }));
      } else if (period === "monthly") {
        // Asumimos hasta 5 semanas
        for (let i = 1; i <= 5; i++) {
          const key = `Semana ${i}`;
          if (map[key]) {
            result.push({ name: key, sales: map[key].sales, expenses: map[key].expenses });
          }
        }
      } else if (period === "annual") {
        const monthOrder = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
        result = monthOrder.map(month => ({
          name: month,
          sales: map[month]?.sales || 0,
          expenses: map[month]?.expenses || 0
        }));
      }
    
      res.json(result);
    } catch (error) {
      console.error("Error en /api/dashboard/sales-vs-expenses:", error);
      res.status(500).json({ message: error.message || "Error al obtener los datos de la gráfica" });
    }
});

router.get('/recent-sales', authMiddleware, async (req, res) => {
    try {
      const { clubId } = req.query;
      if (!clubId) {
        return res.status(400).json({ message: "El clubId es requerido" });
      }
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  
      const recentSales = await Sale.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        created_at: { $gte: startOfDay, $lte: endOfDay }
      })
        .populate({
          path: 'itemGroups.items.product_id',
          select: 'name type flavor portionPrice salePrice'
        })
        .populate({
          path: 'employee',
          model: 'User',
          select: 'nombre displayName'
        })
        .populate({
          path: 'client',
          select: 'name phone'
        })
        .sort({ created_at: -1 })
        .limit(5)
        .lean();
  
      res.json(recentSales);
    } catch (error) {
      console.error("Error en /api/dashboard/recent-sales:", error);
      res.status(500).json({ message: error.message || "Error al obtener las ventas recientes" });
    }
});

module.exports = router;


