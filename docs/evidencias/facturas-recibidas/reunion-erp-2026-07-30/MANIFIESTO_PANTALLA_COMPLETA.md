# Manifiesto de capturas a pantalla completa

Fuente: grabación de Microsoft Teams `Reunión facturas y Albaranes -
CampoJoyma`, revisada el 30/07/2026.

## Método de derivación

- Cada fotograma bruto procede de una captura directa del reproductor pausado
  en modo pantalla completa.
- Resolución de los fotogramas brutos: `1920×1080`.
- Cada captura limpia se deriva del bruto mediante un único recorte:
  `left=0`, `top=68`, `width=1674`, `height=881`.
- El recorte elimina la franja superior negra de Teams, la columna de
  participantes, los controles del reproductor y la barra de tareas.
- No se ha escalado, retocado ni recompuesto el contenido de la pantalla
  compartida.
- Las capturas originales del directorio padre conservan la transcripción y
  siguen siendo la evidencia contextual primaria.

## Inventario e integridad

| Tiempo | Fichero | Bruto: tamaño / bytes / SHA-256 | Limpio: tamaño / bytes / SHA-256 |
|---|---|---|---|
| `06:10` | `01-06m10-formulario-vacio-tipos-factura.png` | `1920×1080` / `192985` / `f2246ab766cbbec26a5c1b4f83e72dfe4f608aea5021c60e89d1cc85083fddf2` | `1674×881` / `577371` / `b53f78c63cb6cddb7459ec16513e2ebafeb8d6ff3c8fe2eea4e4686c05cda753` |
| `07:27` | `02-07m27-acreedor-materiales-con-albaran-ma.png` | `1920×1080` / `215008` / `9dc1da6540208294c772d26da360366ab0358046e8282ac756369d9d918a6024` | `1674×881` / `745993` / `8eeba2b7e708df9e306f8e3ee19dc71a17830d93d6f6ba07b2098628ae9d6447` |
| `08:13` | `03-08m13-acreedor-multiples-gastos-origen-gc.png` | `1920×1080` / `242470` / `4ee6d52e80f3ad3f9e90a7f49abada47f4ef390b51a4870c008480231dacfe11` | `1674×881` / `899210` / `fef58173a5d0bdb831a6d662a3fb1c3849ec303a14589a4dc63c9661584d028a` |
| `11:20` | `04-11m20-visualizador-asiento-contable.png` | `1920×1080` / `228109` / `695f9152f6d91ec13ebdf7f4d1c68cc119053eaefce88d83234b08d70b547b6b` | `1674×881` / `808029` / `7d56980615d98be593bd42c495dd4f00d433025fc3d350b437a992473a3a406c` |
| `13:39` | `05-13m39-buscador-cuentas-gasto.png` | `1920×1080` / `229133` / `d896689579c1219c3531dba92143cac637473c23538969a8ea5c712ca7f3bbf6` | `1674×881` / `822019` / `33ba5e92f9c394498fee5b398ac388e098ab8ee40d0eef3a6ed6b5e7185b81da` |
| `17:08` | `06-17m08-consulta-facturas-proveedor-onduspan.png` | `1920×1080` / `285905` / `85fa4aa9612fa16c5bdcb9b73516a212fb7e6c648465b71b5bc05da2adfd7b96` | `1674×881` / `1221859` / `8d7627639d917358a78bada0c835756ef7f4a686e7f049cfdcc1c72853fde3e4` |
| `19:20` | `07-19m20-soporte-documental-factura-onduspan.png` | `1920×1080` / `118380` / `2e2e3de9adc1e0b8bf3075f08acbee3d31ab3abe235c32bc1a1672840ea67b7a` | `1674×881` / `289541` / `efce08586534f5ef7a4a3c603eac30f6b8d073d017ba0b99ab4d0a19dd837050` |
| `21:25` | `08-21m25-onduspan-punteos-ma-control-total.png` | `1920×1080` / `222784` / `b86e12471e6b1d1ab5ceda1a1f250bae542bbcdb7edf0f38855f357dfdc0f21d` | `1674×881` / `713298` / `afe04203693ec3cf75dcd760081a876cb0078105acf1e0d36c98384f77dea4cf` |
| `22:13` | `09-22m13-detalle-albaran-materiales.png` | `1920×1080` / `166817` / `70408711805b887e783c7db8301e72daca1c7524d8ddd24aec9675ecc7f13e90` | `1674×881` / `427283` / `0448b5d69639783d79d4f3851bd7d1f024f4ae704a835c9ba48a71cbebcd58a2` |
| `23:26` | `10-23m26-contabilizar-y-asiento.png` | `1920×1080` / `225801` / `4619672de68d6c6adfa8bb4ad10e1d4da91e26e0becb73b1d57871a37ce0ccf7` | `1674×881` / `748931` / `e386b0da5d11fb548be6120cbd390ecf4fee1064a7368aa9690fe6359545872a` |

Ubicaciones:

- Brutos: [`fotogramas-pantalla-completa/`](fotogramas-pantalla-completa/)
- Limpios: [`limpias-pantalla-completa/`](limpias-pantalla-completa/)
- Dossier y capturas originales: [`README.md`](README.md)
