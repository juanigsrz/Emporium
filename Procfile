release: python backend/manage.py migrate --noinput
web: gunicorn bgtrade.wsgi --chdir backend --bind 0.0.0.0:$PORT
worker: celery -A bgtrade worker -l info --workdir backend
