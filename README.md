# EMBL-EBI HPC CO2 website

Tracking the carbon footprint of EMBL-EBI's High Performance Computing cluster.

## Installation

```shell
conda create -c conda-forge -n ebi-co2 -y python=3.10 nodejs
source activate ebi-co2
pip install -r requirements.txt
npm i -g http-server
```

## API

Set environment variables:

```shell
export ADMIN_EMAIL=me@domain.com
export DATABASE=/path/to/database.sqlite
export SMTP_HOST=smtp.domain.com
export SMTP_PORT=587

# Optional:
export ADMIN_SLACK=https://my.entreprise.slack.com/user/@MEMBER_ID
export DAYS=14
export NOTIFY_ON_SIGNUP=true
```

Start the server:

```shell
uvicorn [--reload] --host 0.0.0.0 --port 5000 --workers 4 api:app
```

## Client

```shell
http-server --log-ip -a 0.0.0.0 -p 8080 client
```