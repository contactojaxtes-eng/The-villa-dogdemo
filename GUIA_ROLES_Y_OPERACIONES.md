# 📋 THE VILLA DOG DOMICILIOS - MANUAL DE ROLES Y OPERACIONES

Este documento detalla las funciones de cada rol de usuario en la plataforma de **The Villa Dog** para garantizar una operación diaria fluida, evitar descuadres de caja y agilizar las entregas a domicilio en Montería.

---

## 🗺️ Mapa de Flujo Operativo (Mermaid)

```mermaid
graph TD
    subgraph "1. TOMA DE PEDIDO (Gestor de Domicilios / Admin)"
        A[Cliente llama o escribe] --> B[Crear pedido en POS / Nuevo Pedido]
        B --> C[Seleccionar Zona/Barrio y aplicar Tarifa de Envío]
        C --> D[Guardar Pedido - Estado: PENDIENTE]
    end

    subgraph "2. PREPARACIÓN & COCINA (Gestor de Domicilios / Admin)"
        D --> E[Imprimir Comanda de Cocina]
        E --> F[Marcar como Listo cuando cocina termina - Estado: LISTO]
    end

    subgraph "3. DESPACHO & CONTROL (Gestor de Domicilios / Admin)"
        F --> G[Tomar Pedido y asignar a Motorizado en turno]
        G --> H[Marcar: EN RUTA (El motorizado sale del local)]
        H --> I[Marcar: ENTREGADO (Confirmación del cliente)]
    end

    subgraph "4. FACTURACIÓN & CAJA (Cajero / Admin)"
        I --> J[Confirmar pago y cuadrar cuentas]
        J --> K[Realizar Cierre de Caja al final del turno]
    end

    style D fill:#F59E0B,stroke:#333,stroke-width:2px,color:#000
    style F fill:#10B981,stroke:#333,stroke-width:2px,color:#000
    style H fill:#8B5CF6,stroke:#333,stroke-width:2px,color:#fff
    style I fill:#90BF50,stroke:#333,stroke-width:2px,color:#000
```

---

## 👥 Definición de Responsabilidades por Rol

### 1. 🔑 Super Admin / Administrador (`SUPERADMIN` / `ADMIN`)
*Tiene acceso al 100% de las pantallas y configuraciones del sistema.*

* **Menú y Precios:** Crear, editar y pausar platos, precios o categorías en la sección **Menú**.
* **Gestión de Barrios:** Configurar las tarifas de envío para cada barrio de Montería en la sección **Barrios**.
* **Administración de Personal:** Crear credenciales y gestionar los roles de los cajeros y gestores de domicilios en **Usuarios**.
* **Control de Cajas:** Dar de alta o configurar las cajas registradoras del local en **Cajas**.
* **Finanzas e Inventario:** Analizar el rendimiento en **Reportes**, auditar los cierres de caja y gestionar las existencias y recetas en **Inventario**.
* **Configuración General:** Administrar las variables de negocio y sesiones de WhatsApp en **Configuración**.

---

### 2. 💸 Cajero (`CASHIER`)
*Encargado directo del dinero físico, validación de transferencias bancarias y cierres de caja.*

* **Control de la Caja Diaria:**
  * **Apertura:** Inicia el turno en la sección **Pagos / Caja** ingresando el dinero base (efectivo inicial).
  * **Operación y Cobro:** Recibe y valida los pagos de clientes/motorizados (efectivo, transferencias Nequi/Daviplata/Bancolombia) y confirma los comprobantes cargados en el sistema.
  * **Registro de Gastos:** Registra de inmediato cualquier salida de efectivo físico de la caja (ej. compras menores, hielo, insumos urgentes) en la pestaña de **Gastos** para evitar descuadres.
  * **Cierre:** Al finalizar el día, realiza el conteo del efectivo y de las transferencias registradas para hacer el cierre de caja.
* **Consulta de Historial:** Puede ver e imprimir los pedidos en la sección **Pedidos** para verificar detalles de facturación o resolver reclamos de clientes, pero **no tiene permisos para crear, editar ni cancelar pedidos**.

---

### 3. 🛵 Gestor de Domicilios (`DELIVERY_MANAGER`)
*Encargado de la toma de pedidos por canales de venta y de toda la logística de preparación y despacho de comandas.*

* **Toma de Pedidos:** Recibe los pedidos de clientes y los registra directamente en la pantalla de **Nuevo Pedido** (al elegir la zona, el sistema calcula el recargo de domicilio automáticamente).
* **Monitoreo de Cocina y Estados:**
  * Supervisa la preparación de pedidos y cambia el estado del pedido a **Listo** (`READY`) cuando la cocina termina.
  * Asigna los pedidos listos a los domiciliarios en turno (haciendo clic en **Tomar pedido**).
* **Despacho y Ruta:**
  * Cambia el estado a **En Ruta** (`IN_ROUTE`) al momento exacto en que el motorizado sale del restaurante.
  * Presiona el botón de **WhatsApp rápido** para enviarle al domiciliario por chat la dirección exacta, el mapa y el cobro del pedido.
  * Cambia el estado a **Entregado** (`DELIVERED`) en cuanto el motorizado reporta la entrega exitosa.
  * Tiene permisos para **Editar** o **Cancelar** pedidos activos si el cliente realiza un cambio de última hora.

---

## 🔒 Restricciones y Permisos del Sistema (Cómo está Protegida la App)

El sistema oculta y bloquea funciones automáticamente según el rol del usuario que haya iniciado sesión:

| Pantalla / Acción | Admin / Super Admin | Cajero (`CASHIER`) | Gestor de Domicilios (`DELIVERY_MANAGER`) |
| :--- | :---: | :---: | :---: |
| **Inicio (Dashboard)** | ✅ Completo | ✅ Solo caja y pedidos | ✅ Solo estadísticas de domicilios |
| **Pedidos (Historial completo)** | ✅ Completo | ✅ Solo Lectura / Impresión | ✅ Acceso total y logística |
| **Nuevo Pedido (POS)** | ✅ Permitido | ❌ Bloqueado | ✅ Permitido |
| **Cambiar Estados (Listo / En Ruta)** | ✅ Permitido | ❌ Bloqueado | ✅ Permitido |
| **Editar o Cancelar Pedidos** | ✅ Permitido | ❌ Bloqueado | ✅ Permitido |
| **Pagos y Control de Caja** | ✅ Permitido | ✅ Permitido | ❌ Bloqueado (Acceso Denegado) |
| **Gastos e Insumos** | ✅ Permitido | ✅ Permitido | ❌ Bloqueado |
| **Reportes Financieros** | ✅ Permitido | ❌ Bloqueado | ❌ Bloqueado |
| **Inventario y Recetas** | ✅ Permitido | ❌ Bloqueado | ❌ Bloqueado |
| **Gestión de Cuentas de Personal** | ✅ Permitido | ❌ Bloqueado | ❌ Bloqueado |
| **Configuraciones Técnicas** | ✅ Permitido | ❌ Bloqueado | ❌ Bloqueado |

---

## 💡 Consejos para Mantener la Operación Organizada

1. **Flujo Claro de Dinero:** El cajero es el único con acceso a las pantallas de Caja y Gastos. Si un gestor de domicilios o domiciliario necesita dinero para un gasto, el cajero debe registrar la salida en el sistema bajo su usuario.
2. **Registro Logístico Exclusivo:** Solo el gestor de domicilios y los administradores gestionan los pedidos. El cajero solo visualiza el historial para cruzar cuentas de pago al final del turno.
3. **WhatsApp del Motorizado:** El gestor de domicilios debe usar el enlace rápido de WhatsApp para pasar los datos del cliente al repartidor sin teclearlos manualmente, ahorrando tiempo en cada comanda.
