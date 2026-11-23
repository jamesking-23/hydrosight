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

## Phase 3 update
| MET Norway Locationforecast 2.0 | Hourly rain forecast (`forecast`) | CC BY 4.0, commercial use allowed per MET Norway FAQ; needs User-Agent with contact details; attribution shown in UI | Adapter built; live calls UNVERIFIED |
| Open-Meteo | (not used) | Free API is non-commercial only; paid plan needed | Rejected for commercial product |

## Phase 6 update
| HEC-HMS, HEC-RAS (US Army Corps of Engineers) | Hydrological/hydraulic model outputs via the external adapter interface | NO | UNVERIFIED; interface only |
| LISFLOOD / GloFAS (Copernicus) | River discharge forecasts | NO | UNVERIFIED; interface only |
| Google Flood Hub | Flood forecasts | NO; access and terms unknown | UNVERIFIED; interface only |

## Phase 7 update
| Source | Use | Integrated | Status |
|---|---|---|---|
| Customer-supplied assets, elevations, values | Asset registry | YES (user input, labelled `estimated` unless the user says measured) | Supplied by customers |
| Hazard layers (any) | Intersection with assets | NO data loaded; loader function exists | Each needs source + licence on load |
| River network | Distance to waterways | NO data loaded | UNVERIFIED |
| FastFlood (fastflood.org; van den Bout et al. 2023, Environ. Model. Softw. 168:105787; EGU23-3611) | Reference for a future fast flood-hazard layer | NO | Papers are CC BY 4.0. Site lists free and paid tiers; licence for commercial use UNVERIFIED. Outputs, if ever used, would load as hazard zones with source, licence and `estimated`/`synthetic` labels and need local validation |
| OpenLISEM (van den Bout and Jetten 2018, J. Hydrol. 556:674-688) | Reference on flow approximations | NO | Paper CC BY-NC-ND (read only). Its finding that kinematic routing can overstate connectivity at coarse resolution is a caution for any future routing choice |

## Phase 8 update
| Source | Use | Integrated | Status |
|---|---|---|---|
| Gemini API (Google), model `gemini-3.8-flash` | Language model for the data assistant | Adapter built; NOT called live (build environment cannot reach it) | Free tier per Google pricing page; free-tier content used to improve Google products; limits and terms UNVERIFIED |
| Claude API (Anthropic) | Optional alternative model | Adapter built; not configured | Paid; terms UNVERIFIED |

## Phase 9 update
No data source added. Plans, limits, prices and invoices are entered by the platform owner. No third-party pricing or payment data is used or displayed.
