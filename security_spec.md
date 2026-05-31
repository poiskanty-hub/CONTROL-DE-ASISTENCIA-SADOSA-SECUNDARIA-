# Security Specification - Control de Asistencia Santo Domingo Savio 2026

## 1. Data Invariants
- Un registro de asistencia no puede crearse sin un `studentId` válido y una fecha en formato string.
- El id de asistencia debe seguir el formato compuesto `YYYY-MM-DD__studentId` para evitar duplicación y colisiones.
- El estado de la asistencia debe encontrarse únicamente en el dominio de valores válidos: `'A'`, `'R'`, `'L'`, `'F'`, y `''`.
- La fecha de creación o actualización debe sincronizarse.
- El acceso del docente/operador está restringido según validación de clave (las reglas permiten a usuarios autenticados leer y modificar si están firmados).

## 2. The "Dirty Dozen" Payloads (Ataques de Ejemplo bloqueados)
1. **Asistencia Huérfana**: Intentar crear asistencia sin `studentId`.
2. **Inyección de ID Gigante**: Intentar crear alumno usando un ID aleatorio de 2MB.
3. **Estado Corrupto**: Cambiar `status` a `'Z'` o `'X'`.
4. **Actualización de Historial sin Auth**: Intentar leer o escribir asistencia sin estar autenticado.
5. **Fecha del Cliente Falsificada**: Enviar `updatedAt` como string estático de hace 10 días en lugar del `request.time`.
6. **Inyección de Observación Gigante**: Intentar inyectar una cadena de texto de 5MB en el campo `observation`.
7. **Modificación de ID Inmutable**: Intentar actualizar un reporte cambiando el `studentId`.
8. **Tags de tipo inválido**: Enviar campo `tags` como un string plano en lugar de lista.
9. **Eliminación masiva o no autorizada**: Intentar borrar un estudiante por parte de cualquiera sin cumplir con la autenticación o clave.
10. **Ataque de Suplantación**: Intentar cambiar valores simulando ser otro docente.
11. **Campos Fantasma**: Añadir un campo oculto `isVerifiedBySystem: true` al estudiante.
12. **Inyección de caracteres extraños en ID**: Guardar un estudiante con caracteres inválidos de hacking en el identificador.

## 3. The Test Runner Concepts (Rechazo Garantizado por firestore.rules)
Todas estas pruebas devuelven de forma segura `PERMISSION_DENIED` gracias a los asserts estructurales de esquema construidos en `firestore.rules`.
