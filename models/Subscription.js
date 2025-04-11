const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Esquema que define cada entrada del historial de pagos.
 */
const PaymentSchema = new Schema({
  invoiceId: { type: String, required: true },
  date: { type: Date, default: Date.now },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'failed'], default: 'paid' }
});

/**
 * Esquema de la suscripción. Maneja tanto planes predefinidos (prueba, básico, intermedio, premium)
 * como planes personalizados, donde se calculan cargos adicionales.
 */
const SubscriptionSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  plan: {
    type: String,
    enum: ['prueba', 'basico', 'intermedio', 'premium', 'personalizado'],
    default: 'prueba'
  },
  // Fechas de inicio y expiración de la suscripción o prueba
  fechaInicio: { type: Date, default: Date.now },
  fechaExpiracion: { type: Date },
  
  // Límites según el plan
  clubsMax: { type: Number, default: 1 },          // club permitido, según el plan
  empleadosMax: { type: Number, default: 2 },        // empleados permitidos
  
  // Para planes personalizados
  clubesExtra: { type: Number, default: 0 },
  empleadosExtra: { type: Number, default: 0 },
  costoClubExtra: { type: Number, default: 50 },
  costoEmpleadoExtra: { type: Number, default: 20 },
  
  // Precio mensual de la suscripción (según plan base o calculado en personalizado)
  precio: { type: Number, default: 0 },

  // Historial de pagos
  paymentHistory: [PaymentSchema],

  // Indicador para que cuando se expire la prueba, el usuario no pueda volver a disfrutarla
  pruebaUsada: { type: Boolean, default: false }
});

// Antes de guardar, se puede definir lógica para calcular límites y precios según el plan.
SubscriptionSchema.pre('save', function(next) {
  // Si el plan es prueba, la suscripción dura 3 días
  if (this.plan === 'prueba') {
    // Solo se permite si no ha sido usada previamente
    if (this.pruebaUsada) {
      return next(new Error('El usuario ya ha usado la prueba gratuita.'));
    }
    this.fechaExpiracion = new Date(this.fechaInicio.getTime() + 3 * 24 * 60 * 60 * 1000);
    this.clubsMax = 1;
    this.empleadosMax = 2;
    this.precio = 0;
  } else if (this.plan === 'basico') {
    this.clubsMax = 1;
    this.empleadosMax = 2;
    this.precio = 110;
  } else if (this.plan === 'intermedio') {
    this.clubsMax = 2;
    this.empleadosMax = 4;
    this.precio = 150;
  } else if (this.plan === 'premium') {
    this.clubsMax = 3;
    this.empleadosMax = 10;
    this.precio = 200;
  } else if (this.plan === 'personalizado') {
    // En caso de planes personalizados, se espera que se hayan definido clubesExtra y empleadosExtra
    // El precio se calcula sumando el plan básico más los extras
    this.clubsMax = 1 + this.clubesExtra;
    this.empleadosMax = 2 + this.empleadosExtra;
    // Podrías definir un precio base para el plan personalizado o bien solo cobrar los extras.
    // Ejemplo: precio base de 100 pesos + extras
    this.precio = 100 + (this.clubesExtra * this.costoClubExtra) + (this.empleadosExtra * this.costoEmpleadoExtra);
  }
  next();
});

module.exports = mongoose.model('Subscription', SubscriptionSchema);
