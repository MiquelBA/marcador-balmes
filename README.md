# 🏀 Marcador Escola Pia Balmes

Marcador de bàsquet en directe per a l'equip de l'Escola Pia Balmes.
Una persona porta el marcador des del mòbil i la resta de famílies el veuen en temps real.

## Adreces

- Marcador (famílies): https://piabalmes.com
- Administració: https://piabalmes.com/admin
- Historial: https://piabalmes.com/historial

## Pàgines

| Pàgina | Per a qui | Què fa |
|---|---|---|
| `index.html` | Famílies | Marcador en directe (temps, quart, punts, xiulet i botzina) |
| `admin.html` | Administrador (PIN) | Crear partits, portar el marcador, el rellotge i els sons |
| `historial.html` | Tothom | Partits jugats, resultats i parcials per quart, per temporada |

**Consell:** al mòbil, obre la pàgina i fes *Afegeix a la pantalla d'inici*. S'obrirà a pantalla completa i en horitzontal, com una app.

## Com funciona

- Web estàtica (HTML/CSS/JS) publicada a GitHub Pages.
- Dades i temps real a Supabase (`supabase/migrations/001_init.sql`).
- Les famílies només poden **llegir**. Tots els canvis passen per funcions del servidor que comproven el PIN.
- El rellotge es sincronitza amb l'hora del servidor: tothom veu el mateix temps.
- Els sons (xiulet i botzina) es generen al navegador i sonen a tots els mòbils connectats.

## Afegir un altre equip de l'escola

L'estructura ja admet diversos equips. Executa a Supabase (SQL editor):

```sql
with t as (insert into public.teams(slug, name, category)
           values ('infantil-a', 'Escola Pia Balmes', 'Infantil A') returning id)
insert into public.team_secrets(team_id, pin_hash)
select id, extensions.crypt('PIN_NOU', extensions.gen_salt('bf')) from t;
```

I comparteix els enllaços amb `?equip=infantil-a` (per exemple `https://piabalmes.com/?equip=infantil-a`).

## Canviar el PIN

```sql
update public.team_secrets set pin_hash = extensions.crypt('NOU_PIN', extensions.gen_salt('bf'))
where team_id = (select id from public.teams where slug = 'balmes');
```
