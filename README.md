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
export ADMIN_EMAIL=me@domain.com,another@domain.com
export ADMIN_PASSWORD=********
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

## Screenshot

<a href="https://raw.githubusercontent.com/matthiasblum/embl-ebi-hpc-co2-website/main/embl-ebi-carbon-footprint.png"><img src="embl-ebi-carbon-footprint.png" alt="Screenshot of dashboard" height="400"/></a>
