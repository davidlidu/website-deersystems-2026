# agencias.deersystems.net

Landing estática para agencias (planes WordPress, Shopify, horas y mantenimiento).
Un solo `index.html` con CSS/JS en línea; los tokens de marca replican `src/styles.css` del sitio principal.

## Despliegue en Dokploy
- Nueva aplicación → Build type **Dockerfile**, *Build path* `/agencias`, Dockerfile `Dockerfile`.
- Dominio `agencias.deersystems.net` (HTTPS con Let's Encrypt), puerto contenedor **80**.
- DNS: registro A/CNAME de `agencias` hacia el VPS.

## Local
```bash
cd agencias && npx serve .   # o abrir index.html directamente
```
