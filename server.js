// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const socketIo = require('socket.io');

// Inicializar Express
const app = express();
app.use(express.json());
app.use(cors());
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Configurar servidor HTTP y Socket.IO para tiempo real
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: "*" } });
app.set('socketio', io);

io.on('connection', (socket) => {
  console.log('Nuevo cliente conectado');
  socket.emit('message', 'Bienvenido al sistema en tiempo real');
  socket.on('disconnect', () => {
    console.log('Cliente desconectado');
  });
});

// Rutas de autenticación y onboarding
const authRoutes = require('./routes/auth');
const onboardingRoutes = require('./routes/onboarding');
const productRoutes = require('./routes/products');
const inventoryRoutes = require('./routes/inventory');
const salesRoutes = require('./routes/sales');
const clientRoutes = require('./routes/clients');
const expenseRoutes = require('./routes/expenses');
const dashboardRoutes = require('./routes/dashboard');
const clubRoutes = require('./routes/club');
const userRoutes = require('./routes/user');
const subscriptionRoutes = require('./routes/subscription');
const paymentRoutes = require('./routes/payment');
const employeeRoutes = require('./routes/employee');
const reportRoutes = require('./routes/reportRoutes');
app.use('/api/auth', authRoutes);
app.use('/api/onboarding', onboardingRoutes);
app.use('/api/products', productRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/users', userRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/reports', reportRoutes);
app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode === 400 || res.statusCode === 401) {
      console.warn(
        `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode}`
      );
    }
  });
  next();
});

// Conexión a MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('Conectado a MongoDB'))
.catch(err => console.error('Error conectando a MongoDB', err));

// Iniciar el servidor
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
