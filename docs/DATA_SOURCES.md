# External data sources

Rule 12: verify licence and commercial-use terms **before** integrating. Record the result here.

| Source | Intended use | Licence / terms checked? | Status |
|---|---|---|---|
| Open-Meteo | Forecast rainfall (stored as `forecast`) | NO | UNVERIFIED |
| OpenStreetMap (roads, schools, health facilities) | Map layers | ODbL known; attribution required; exact usage NOT yet reviewed | UNVERIFIED |
| Copernicus DEM / NASADEM | Elevation sampling | NO | UNVERIFIED |
| CHIRPS | Satellite rainfall (`estimated`) | NO | UNVERIFIED |
| NASA GPM IMERG | Satellite rainfall (`estimated`) | NO | UNVERIFIED |
| Uganda National Meteorological Authority / Ministry of Water and Environment | Official observations/warnings | Access NOT assumed | UNVERIFIED |

Status after Phase 2: nothing external is integrated. OSM raster tiles are used only as a basemap (attribution shown). No river/catchment/OSM/DEM data is loaded; demo stations are synthetic.
