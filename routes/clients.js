const express = require('express');
const mongoose = require('mongoose');
const authMiddleware = require('../middlewares/auth');
const Client = require('../models/Client');
const Sale = require('../models/Sale');
const Product = require('../models/Product'); // <-- Nueva línea


const router = express.Router();

// POST /clients       → Crear cliente
// PUT  /clients/:id   → Editar cliente
// GET  /clients       → Listar clientes del club activo (clubId desde token)

router.post('/', authMiddleware, async (req, res) => {
  const { name, email, phone, type, clubId } = req.body;
  

  // Validaciones básicas
  if (!name) {
    return res.status(400).json({ message: "El nombre es obligatorio" });
  }
  if (!email && !phone) {
    return res.status(400).json({ message: "Debes proporcionar al menos un método de contacto" });
  }
  if (!clubId) {
    return res.status(400).json({ message: "Club id es requerido" });
  }

  console.log("Creando cliente2:", req.body);

  try {
    const client = new Client({
      name,
      email,
      phone,
      type,
      clubId: new mongoose.Types.ObjectId(clubId),
    });

    await client.save();
    return res.status(201).json(client);
  } catch (error) {
    console.error("Error al crear el cliente:", error);
    return res.status(500).json({ message: "Error al crear el cliente", error });
  }
});



router.get('/', authMiddleware, async (req, res) => {
  const { clubId } = req.query;
  if (!clubId) {
    return res.status(400).json({ message: "Club id es requerido" });
  }

  try {
    const clients = await Client.find({ clubId });
    console.log(clients);
    return res.status(200).json(clients);
  } catch (error) {
    console.error("Error al obtener clientes:", error);
    return res.status(500).json({ message: "Error al obtener clientes", error });
  }
});

// Obtener KPIs para el club activo
router.get('/kpis', authMiddleware, async (req, res) => {
  const { clubId } = req.query;
  if (!clubId) {
    return res.status(400).json({ message: "Club id es requerido" });
  }

  try {
    const clients = await Client.find({ clubId });

    const totalClientes = clients.length;
    const clientesFrecuentes = clients.filter(c => c.type === 'regular').length;

    // Mejor cliente: el que más ha gastado
    const mejorCliente = clients.reduce((prev, current) => {
      return current.total_spent > (prev.total_spent || 0) ? current : prev;
    }, {});

    // Cliente Asiduo: el que tiene mayor cantidad de visitas (visitCount)
    const clienteAsiduo = clients.reduce((prev, current) => {
      return current.visitCount > (prev.visitCount || 0) ? current : prev;
    }, {});

    // Última compra: la fecha más reciente entre los clientes que tengan last_purchase
    const clientesConCompra = clients.filter(c => c.last_purchase);
    const ultimaCompra = clientesConCompra.length
      ? new Date(Math.max(...clientesConCompra.map(c => new Date(c.last_purchase).getTime())))
      : null;

    return res.status(200).json({
      totalClientes,
      clientesFrecuentes,
      mejorCliente: mejorCliente._id ? mejorCliente : null,
      clienteAsiduo: clienteAsiduo._id ? clienteAsiduo : null,
      ultimaCompra // se devuelve como fecha
    });
  } catch (error) {
    console.error("Error al obtener KPIs:", error);
    return res.status(500).json({ message: "Error al obtener KPIs", error });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, type, clubId } = req.body;

  if (!name) {
    return res.status(400).json({ message: "El nombre es obligatorio" });
  }
  if (!email && !phone) {
    return res.status(400).json({ message: "Debes proporcionar al menos un método de contacto" });
  }
  if (!clubId) {
    return res.status(400).json({ message: "Club id es requerido" });
  }

  try {
    // Actualiza el cliente filtrando también por clubId para seguridad
    const updatedClient = await Client.findOneAndUpdate(
      { _id: id, clubId },
      { name, email, phone, type, updatedAt: new Date() },
      { new: true }
    );

    if (!updatedClient) {
      return res.status(404).json({ message: "Cliente no encontrado" });
    }

    return res.status(200).json(updatedClient);
  } catch (error) {
    console.error("Error al actualizar el cliente:", error);
    return res.status(500).json({ message: "Error al actualizar el cliente", error });
  }
});

router.get('/client/:clientId', authMiddleware, async (req, res) => {
  const { clientId } = req.params;
  const { clubId, start, end } = req.query;

  if (!clubId) {
    return res.status(400).json({ message: 'El clubId es requerido.' });
  }

  try {
    const query = { client: clientId, clubId };

    if (start && end) {
      query.createdAt = {
        $gte: new Date(start),
        $lte: new Date(end),
      };
    }

    const sales = await Sale.find(query).sort({ created_at: -1 });
    
    const productIds = [];
    sales.forEach(sale => {
      if (sale.itemGroups && sale.itemGroups.length) {
        sale.itemGroups.forEach(group => {
          if (group.items && group.items.length) {
            group.items.forEach(item => {
              productIds.push(item.product_id);
            });
          }
        });
      }
    });
    const uniqueProductIds = [...new Set(productIds)];

    const products = await Product.find({ _id: { $in: uniqueProductIds } }).select('name flavor');
    const productMap = {};
    products.forEach(product => {
      productMap[String(product._id)] = {
        name: product.name,
        flavor: product.flavor || 'Sin sabor'
      };
    });

    const transformedSales = sales.map(sale => {
      const flatItems = [];
      if (sale.itemGroups && sale.itemGroups.length) {
        sale.itemGroups.forEach(group => {
          if (group.items && group.items.length) {
            group.items.forEach(item => {
              const productInfo = productMap[String(item.product_id)] || { name: 'Desconocido', flavor: 'Sin sabor' };
              flatItems.push({
                ...item.toObject(),
                productName: productInfo.name,
                flavor: productInfo.flavor
              });
            });
          }
        });
      }
      
      const saleObj = sale.toObject();
      saleObj.items = flatItems;
      return saleObj;
    });

    return res.status(200).json(transformedSales);
  } catch (error) {
    console.error("Error al obtener el historial de ventas:", error);
    return res.status(500).json({ message: "Error al obtener el historial de ventas", error });
  }
});

module.exports = router;
