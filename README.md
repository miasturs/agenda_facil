# Agenda Fácil

Aplicación web para la gestión de citas y clientes, orientada a profesionales independientes como estilistas, barberos, manicuristas, terapeutas y consultores.

Agenda Fácil es una aplicación completamente frontend, contenida en un único archivo `index.html`, que no requiere backend, base de datos externa ni proceso de compilación. Toda la información se almacena localmente en el dispositivo del usuario mediante `localStorage`.

## Tabla de contenido

- [Características](#características)
- [Demostración y uso](#demostración-y-uso)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Tecnologías utilizadas](#tecnologías-utilizadas)
- [Almacenamiento de datos](#almacenamiento-de-datos)
- [Roadmap](#roadmap)
- [Contribuciones](#contribuciones)
- [Licencia](#licencia)
- [Autor](#autor)

## Características

### Gestión de citas

- Vista de agenda diaria con resumen de citas, monto cobrado y saldo pendiente.
- Vista de listado general con filtros por estado: todas, pendientes, atendidas, pasadas y canceladas.
- Vista de calendario mensual con indicadores de color según el estado de cada cita.
- Modo día completo, optimizado para tabletas y dispositivos móviles.
- Cambio de estado de citas entre pendiente, atendida y cancelada.
- Control de pagos mediante marcación de citas como pagadas o por cobrar.
- Duración configurable por cita, entre 30 minutos y 2 horas.
- Validación automática de conflictos de horario.

### Gestión de clientes

- Registro manual de clientes o importación desde los contactos del dispositivo (Chrome en Android).
- Búsqueda por nombre o número de teléfono.
- Índice alfabético lateral para navegación rápida.
- Ficha de cliente con estadísticas: total de citas, monto acumulado y número de visitas.
- Notas libres por cliente (alergias, preferencias, observaciones).
- Historial completo de citas con acceso directo a edición.
- Acciones rápidas para agendar una nueva cita o eliminar el cliente junto con sus citas asociadas.

### Integración con WhatsApp

- Envío de recordatorios mediante enlace directo a WhatsApp.
- Plantilla de mensaje configurable con variables dinámicas:
  - `{nombre}`, `{fecha}`, `{hora}`, `{servicio}`, `{precio}`, `{negocio}`.
- Vista previa en tiempo real de la plantilla configurada.

### Interfaz y experiencia de usuario

- Cinco temas visuales intercambiables: suave, gris, iOS, morado y rojo.
- Diseño responsivo con navegación inferior en dispositivos móviles.
- Gestos táctiles para desplazamiento horizontal entre vistas.
- Animaciones y transiciones suaves.
- Soporte para safe-area en dispositivos iPhone (notch y dynamic island).
- Tipografías Plus Jakarta Sans y Playfair Display.

### Progressive Web App

- Instalable en Android, iOS y escritorio.
- Funcionamiento offline mediante Service Worker.
- Manifest generado dinámicamente en tiempo de ejecución.
- Adaptación del `theme-color` al tema activo.

### Funciones adicionales

- Notificaciones locales quince minutos antes de cada cita (requiere permiso del navegador).
- Solicitud de almacenamiento persistente para reducir el riesgo de pérdida de datos.
- Retroalimentación háptica en dispositivos compatibles.
- Mensajes de confirmación con acciones rápidas.

## Demostración y uso

No requiere instalación. Basta con abrir el archivo `index.html` en un navegador moderno.

### Uso inicial

1. Clonar o descargar el repositorio.
2. Abrir `index.html` en el navegador.
3. Acceder a **Ajustes** para configurar el nombre del negocio y la plantilla de WhatsApp.
4. Registrar los servicios ofrecidos desde el formulario de nueva cita, opción **Administrar**.
5. Registrar clientes desde la pestaña **Clientes** o importarlos desde los contactos.
6. Comenzar a agendar citas.

### Instalación como aplicación

- **Android y Chrome:** el navegador mostrará automáticamente el botón **Instalar aplicación**.
- **iOS y Safari:** utilizar la opción **Compartir** y seleccionar **Añadir a pantalla de inicio**.

## Estructura del proyecto
`text`
agenda-facil/
├── index.html      # Aplicación completa (HTML, CSS y JavaScript)
└── README.md       # Documentación del proyecto

El proyecto se distribuye como un único archivo con el propósito de facilitar su despliegue en cualquier plataforma de hosting estático, como GitHub Pages, Netlify o Vercel, o incluso su apertura local.

## Tecnologías utilizadas

| Tecnología | Uso |
| --- | --- |
| HTML5 | Estructura y semántica del documento |
| Tailwind CSS (CDN) | Sistema de diseño y utilidades de estilo |
| CSS personalizado | Temas, animaciones y ajustes de safe-area |
| JavaScript (Vanilla) | Lógica completa de la aplicación |
| Lucide Icons | Iconografía vectorial |
| Google Fonts | Tipografías Plus Jakarta Sans y Playfair Display |
| Service Worker | Soporte offline y funcionalidades PWA |
| localStorage | Persistencia de citas, clientes y preferencias |

## Almacenamiento de datos

La información se almacena exclusivamente en el navegador del usuario, bajo las siguientes claves:

- `agenda-facil-data-v4`: servicios, clientes y citas.
- `agenda-facil-prefs`: plantilla de WhatsApp y nombre del negocio.
- `agenda_theme`: tema visual activo.

### Consideraciones importantes

- Si el usuario elimina los datos del navegador o utiliza el modo incógnito, la información se perderá.
- La aplicación solicita almacenamiento persistente para reducir este riesgo, pero no constituye una garantía absoluta.
- No existe sincronización entre dispositivos ni respaldo automático.

## Roadmap

- Exportación e importación de respaldos en formato JSON.
- Sincronización opcional con servicios en la nube.
- Soporte multi-idioma (español e inglés).
- Recordatorios automáticos vía SMS.
- Estadísticas semanales y mensuales.
- Modo oscuro automático según la hora del día.

## Contribuciones

Las contribuciones son bienvenidas. Para proponer cambios o reportar problemas:

1. Abrir un issue describiendo el problema o la mejora propuesta.
2. Realizar un fork del repositorio.
3. Crear una rama descriptiva: `git checkout -b feature/nueva-funcionalidad`.
4. Registrar los cambios con un mensaje claro: `git commit -m "Añade nueva funcionalidad"`.
5. Publicar la rama: `git push origin feature/nueva-funcionalidad`.
6. Abrir un pull request detallando los cambios realizados.

Se recomienda mantener el estilo de código existente y verificar el funcionamiento en navegadores de escritorio y móviles antes de enviar una contribución.

## Licencia

Este proyecto se distribuye bajo la licencia MIT. Se permite su uso, modificación y distribución, incluso con fines comerciales, siempre que se conserve el aviso de copyright original.

## Autor

Desarrollado como una solución simple y autónoma para profesionales que necesitan organizar su agenda sin depender de plataformas externas.
