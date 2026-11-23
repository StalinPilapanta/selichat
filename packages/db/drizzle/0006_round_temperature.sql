-- Temperaturas guardadas cuando la columna era real (float4) quedaron como 0.4000000059604645.
UPDATE agent_configs SET temperature = round(temperature::numeric, 2)::double precision
WHERE temperature <> round(temperature::numeric, 2)::double precision;
