// routes/products.js
const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const Inventory = require('../models/Inventory');  // Importa el modelo de Inventario
const authMiddleware = require('../middlewares/auth');

// Endpoint para crear un producto
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      type,
      name,
      brand,
      category,
      portions,         // Se usará para definir las porciones por envase en productos de preparación o ambos.
      portionSize,      // Tamaño de la porción (solo para productos preparados o ambos)
      portionPrice,     // Precio por porción (solo para productos preparados o ambos)
      salePrice,
      purchasePrice,
      flavor,
      imageUrl,
      clubId
    } = req.body;

    // Validación básica: se debe enviar el clubId
    if (!clubId) {
      return res.status(400).json({ message: "El ID del club es requerido" });
    }

    // Se asume que req.userId viene del token
    const product = new Product({
      type,
      name,
      brand,
      category,
      portions,
      portionSize,
      portionPrice,
      salePrice,
      purchasePrice,
      flavor,
      imageUrl,
      clubId,
      userId: req.userId,
    });

    await product.save();

    // Crear el registro de inventario basado en el tipo de producto
    let inventoryData = {
      product: product._id,
      clubId,
      updatedAt: new Date(),
    };

    if (type === "sealed") {
      // Para productos sellados, solo se maneja stock sellado.
      inventoryData.sealed = 0;
      // No se establece información de preparación.
    } else if (type === "prepared") {
      // Para productos de preparación, se inicializa el subdocumento preparation.
      inventoryData.preparation = {
        units: 0,
        portionsPerUnit: portions || 0,
        currentPortions: 0,
        portionPrice: portionPrice,
        portionSize: portionSize,
      };
    } else if (type === "both") {
      // Para productos de tipo "both", se definen ambos.
      inventoryData.sealed = 0;
      inventoryData.preparation = {
        units: 0,
        portionsPerUnit: portions || 0,
        currentPortions: 0,
        portionPrice: portionPrice,
        portionSize: portionSize,
      };
    }

    const inventory = new Inventory(inventoryData);
    await inventory.save();

    res.status(201).json({ message: "Producto creado correctamente", product });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { clubId, query } = req.query;
    
    // Validación: se requiere clubId y al menos 1 carácter para la búsqueda
    if (!clubId || !query || query.trim().length < 1) {
      return res.status(400).json({ 
        message: 'Se requieren clubId y al menos 1 carácter para la búsqueda' 
      });
    }

    // Se usa una expresión regular para obtener productos cuyo nombre comience con la consulta
    const products = await Product.find({
      clubId,
      name: { $regex: `^${query.trim()}`, $options: 'i' },
      archived: false,
    })
    .select('name purchasePrice type stock flavor')
    .lean()
    .limit(10);

    // Formateo seguro de resultados
    const safeProducts = products.map(p => ({
      id: p._id.toString(),
      flavor: p.flavor || null,
      name: p.name || '',
      catalogPrice: p.purchasePrice || 0,
      type: p.type || 'sealed',
      stock: p.stock || { sealed: 0, preparation: { units: 0, portionsPerUnit: 0, currentPortions: 0 } }
    }));

    res.json(safeProducts);

  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Error en la búsqueda',
      error: error.message 
    });
  }
});

router.get('/search/sales/', authMiddleware, async (req, res) => {
  try {
    const { clubId, query } = req.query;
    
    if (!clubId) {
      return res.status(400).json({ message: 'Se requiere el clubId para la búsqueda' });
    }

    let searchQuery = {};
    
    // If query is provided, filter by name
    if (query && query.trim().length > 0) {
      searchQuery = {
        clubId,
        name: { $regex: query.trim(), $options: 'i' },
        archived: false
      };
    } else {
      // If no query, just filter by clubId and not archived
      searchQuery = {
        clubId,
        archived: false
      };
    }

    // First get products from catalog
    const products = await Product.find(searchQuery)
      .sort({ name: 1 })
      .lean();
    
    // Then get inventory data for each product
    const productsWithInventory = await Promise.all(products.map(async (product) => {
      const inventory = await Inventory.findOne({
        product: product._id,
        clubId
      }).lean();
      
      // Calculate available stock based on product type
      let stockInfo = {
        sealed: 0,
        prepared: 0,
        portions: 0
      };
      
      if (inventory) {
        stockInfo.sealed = inventory.sealed || 0;
        
        if (inventory.preparation) {
          stockInfo.prepared = inventory.preparation.units || 0;
          stockInfo.portions = inventory.preparation.currentPortions || 0;
          
          // If product has units for preparation, calculate total available portions
          if (product.type === 'prepared' || product.type === 'both') {
            const portionsFromUnits = inventory.preparation.currentPortions || 0;
            console.log("Porciones desde unidades:", portionsFromUnits);
            stockInfo.portions = portionsFromUnits;
            console.log("Total de porciones calculadas:", stockInfo.portions);
          }
        }
      }
      console.log("Stock info:", stockInfo.portions);
      return {
        id: product._id.toString(),
        name: product.name,
        type: product.type,
        price: product.salePrice,
        stock: stockInfo.sealed,
        portions: stockInfo.portions,
        portionPrice: product.portionPrice || 0
      };
    }));
    
    res.json(productsWithInventory);
    console.log("Productos con inventario:", productsWithInventory);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Error en la búsqueda de productos',
      error: error.message 
    });
  }
});

router.get("/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    console.log("ID del producto:", id); // Log para verificar el ID recibido
    // Buscar el producto en la colección Product
    const product = await Product.findById(id);
    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    // Buscar el registro de inventario asociado al producto.
    // Aquí se utiliza el clubId almacenado en el producto, pero puedes modificarlo según tu lógica.
    const inventory = await Inventory.findOne({
      product: id,
      clubId: product.clubId,
    });

    // Si no se encuentra inventario, se asigna un objeto por defecto.
    const stock = inventory
      ? {
          sealed: inventory.sealed,
          preparation: inventory.preparation || {
            units: 0,
            portionsPerUnit: 0,
            currentPortions: 0,
          },
        }
      : {
          sealed: 0,
          preparation: {
            units: 0,
            portionsPerUnit: 0,
            currentPortions: 0,
          },
        };

    // Se devuelve la información del producto combinada con el stock
    res.json({ ...product.toObject(), stock });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message || "Error al obtener el producto" });
  }
});

// Endpoint para actualizar un producto
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const productId = req.params.id;
    const updateData = req.body;

    // Opcional: Validar que el usuario sea el propietario del producto
    const product = await Product.findOneAndUpdate(
      { _id: productId, userId: req.userId },
      updateData,
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado o no autorizado" });
    }

    res.json({ message: "Producto actualizado correctamente", product });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error en el servidor" });
  }
});

router.get('/club/:clubId', authMiddleware, async (req, res) => {
  try {
    console.log("Club ID:", req.params.clubId); // Log para verificar el clubId recibido
    const products = await Product.find({
      clubId: req.params.clubId,
      archived: false
    }).sort({ createdAt: -1 });

    res.json(products);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al obtener productos" });
  }
});

// Archivar producto
router.patch('/:id/archive', authMiddleware, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { archived: true },
      { new: true }
    );

    if (!product) {
      return res.status(404).json({ message: "Producto no encontrado" });
    }

    res.json({ message: "Producto archivado", product });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al archivar producto" });
  }
});


router.get('/search/expenses', authMiddleware, async (req, res) => {
  try {
    const { clubId, query } = req.query;
    
    if (!clubId) {
      return res.status(400).json({ message: 'Se requiere el clubId para la búsqueda' });
    }

    // Configurar la consulta: si se proporciona query, se filtra por nombre; de lo contrario, se filtra solo por clubId
    const searchQuery = query && query.trim().length > 0 
      ? { clubId, name: { $regex: query.trim(), $options: 'i' }, archived: false }
      : { clubId, archived: false };

    // Se obtienen los productos del catálogo, ordenados alfabéticamente y limitados a 2 resultados
    const products = await Product.find(searchQuery)
      .sort({ name: 1 })
      .lean()
      .limit(2);

    // Se obtiene la información de inventario para cada producto
    const productsWithInventory = await Promise.all(products.map(async (product) => {
      const inventory = await Inventory.findOne({
        product: product._id,
        clubId
      }).lean();
      
      // Se calcula la información de stock en base al tipo de producto
      let stockInfo = {
        sealed: 0,
        portions: 0
      };
      
      if (inventory) {
        stockInfo.sealed = inventory.sealed || 0;
        if (inventory.preparation) {
          // Para productos "prepared" o "both", se usa currentPortions
          stockInfo.portions = inventory.preparation.currentPortions || 0;
        }
      }
      
      return {
        id: product._id.toString(),
        name: product.name,
        flavor: product.flavor || null,
        catalogPrice: product.purchasePrice || 0,
        salePrice: product.salePrice || 0,
        type: product.type || 'sealed',
        stock: stockInfo.sealed,
        portions: stockInfo.portions,
        sku: product.sku || ""
      };
    }));
    
    res.json(productsWithInventory);
  } catch (error) {
    console.error(error);
    res.status(500).json({ 
      message: 'Error en la búsqueda de productos',
      error: error.message 
    });
  }
});


module.exports = router;


