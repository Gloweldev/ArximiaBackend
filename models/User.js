// models/User.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const suscripcionSchema = new Schema({
  plan: { type: String, enum: ['basico', 'medio', 'superior', 'prueba'], default: 'prueba' },
  fechaInicio: { type: Date, default: Date.now },
  fechaExpiracion: { type: Date },
  clubsMax: { type: Number, default: 1 },
  empleadosMax: { type: Number, default: 2 },
  tiendasExtra: { type: Number, default: 0 },
  empleadosExtra: { type: Number, default: 0 },
  precio: { type: Number, default: 0 },             // precio mensual
  trialUsed: { type: Boolean, default: false }
}, { _id: false });

const UserSchema = new Schema({
  nombre: { type: String, required: true },
  displayName: { type: String },  // Nuevo campo: nombre para mostrar
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin'], default: 'admin' },
  suscripcion: suscripcionSchema,
  // Nuevos campos:
  clubPrincipal: { type: Schema.Types.ObjectId, ref: 'Tienda', default: null },
  clubs: [{ type: Schema.Types.ObjectId, ref: 'Tienda' }],
  employees: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
  // Campos adicionales para onboarding:
  preferenciasOperativas: { type: Object, default: {} },
  metas: { type: Object, default: {} },
  tieneColaboradores: { type: Boolean, default: false },
  passwordChangeAttempts: { type: Number, default: 0 },
  passwordChangeLockUntil: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  onboardingCompleted: { type: Boolean, default: false },
  inventarioIdeal: { type: Number, default: 5, min: 1 } // Añadir validación mínima
});


UserSchema.pre('save', function(next) {
  if (this.suscripcion) {
    if (this.suscripcion.plan === 'prueba') {
      // Se permite la prueba gratuita de 3 días solo si no se usó anteriormente
      if (!this.suscripcion.trialUsed) {
        this.suscripcion.fechaExpiracion = new Date(this.suscripcion.fechaInicio.getTime() + 3 * 24 * 60 * 60 * 1000);
        this.suscripcion.clubsMax = 1;
        this.suscripcion.empleadosMax = 2;
        this.suscripcion.precio = 0;
      }
    } else if (this.suscripcion.plan === 'basico') {
      this.suscripcion.fechaExpiracion = undefined; // Suscripción activa (se renovará mensualmente)
      this.suscripcion.clubsMax = 1;
      this.suscripcion.empleadosMax = 2;
      this.suscripcion.precio = 110;
    } else if (this.suscripcion.plan === 'intermedio') {
      this.suscripcion.fechaExpiracion = undefined;
      this.suscripcion.clubsMax = 2;
      this.suscripcion.empleadosMax = 4;
      this.suscripcion.precio = 150;
    } else if (this.suscripcion.plan === 'premium') {
      this.suscripcion.fechaExpiracion = undefined;
      this.suscripcion.clubsMax = 3;
      this.suscripcion.empleadosMax = 10;
      this.suscripcion.precio = 200;
    } else if (this.suscripcion.plan === 'personalizado') {
      this.suscripcion.fechaExpiracion = undefined;
      // Se parte de los límites básicos y se le suman los extras
      this.suscripcion.clubsMax = 1 + this.suscripcion.clubsExtra;
      this.suscripcion.empleadosMax = 2 + this.suscripcion.empleadosExtra;
      // Precio base de 100 más el costo por extras
      this.suscripcion.precio = 100 + (this.suscripcion.clubsExtra * 50) + (this.suscripcion.empleadosExtra * 20);
    }
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);
