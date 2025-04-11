// routes/dashboard.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/auth');

// Modelos necesarios
const Sale = require('../models/Sale');
const Expense = require('../models/Expense');
const Inventory = require('../models/Inventory');

// GET /api/dashboard/kpis?clubId=...
router.get('/kpis', authMiddleware, async (req, res) => {
    try {
      const { clubId } = req.query;
      if (!clubId) {
        return res.status(400).json({ message: "El clubId es requerido" });
      }
  
      // Período actual: mes actual
      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
      // Período anterior: mismo lapso que el mes actual, pero el mes anterior
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const startOfPrevMonth = new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 1);
      const endOfPrevMonth = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0, 23, 59, 59);
  
      // Consultar ventas y gastos en el período actual
      const salesCurrent = await Sale.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        created_at: { $gte: startOfMonth, $lte: endOfMonth }
      });
      const expensesCurrent = await Expense.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        date: { $gte: startOfMonth, $lte: endOfMonth }
      });
  
      // Consultar ventas y gastos en el período anterior
      const salesPrev = await Sale.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        created_at: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      });
      const expensesPrev = await Expense.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        date: { $gte: startOfPrevMonth, $lte: endOfPrevMonth }
      });
  
      // Calcular totales actuales
      const salesTotalCurrent = salesCurrent.reduce((sum, sale) => sum + sale.total, 0);
      const expensesTotalCurrent = expensesCurrent.reduce((sum, expense) => sum + expense.amount, 0);
      const netProfitCurrent = salesTotalCurrent - expensesTotalCurrent;
  
      // Calcular totales del período anterior
      const salesTotalPrev = salesPrev.reduce((sum, sale) => sum + sale.total, 0);
      const netProfitPrev = salesTotalPrev - expensesPrev.reduce((sum, expense) => sum + expense.amount, 0);
  
      // Calcular tendencias (si el valor previo es mayor a 0)
      const salesGrowth = salesTotalPrev > 0 
        ? Number((((salesTotalCurrent - salesTotalPrev) / salesTotalPrev) * 100).toFixed(1))
        : 0;
      const netProfitGrowth = netProfitPrev > 0
        ? Number((((netProfitCurrent - netProfitPrev) / netProfitPrev) * 100).toFixed(1))
        : 0;
  
      // Inventario crítico: por ejemplo, se considera crítico si
      // para productos sellados: stock < 5
      // para productos de preparación: currentPortions < 10
      const criticalInventory = await Inventory.find({
        clubId: new mongoose.Types.ObjectId(clubId),
        $or: [
          { sealed: { $lt: 5 } },
          { "preparation.currentPortions": { $lt: 10 } }
        ]
      }).populate('product', 'name flavor'); // Se asume que el modelo Product tiene estos campos
  
      // Armar lista de inventario crítico
      const inventoryItems = criticalInventory.map(item => ({
        name: item.product
          ? `${item.product.name}${item.product.flavor ? " (" + item.product.flavor + ")" : ""}`
          : "Producto desconocido",
        stock: item.sealed < 5 ? `${item.sealed} unidades` : `${item.preparation.currentPortions} porciones`
      }));
  
      res.json({
        salesTotal: salesTotalCurrent,
        expensesTotal: expensesTotalCurrent,
        netProfit: netProfitCurrent,
        salesGrowth,
        netProfitGrowth,
        inventoryCritical: criticalInventory.length,
        inventoryItems,
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


