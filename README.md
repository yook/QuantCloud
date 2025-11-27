# Proxy Server с авторизацией

Простой прокси-сервер на Node.js с авторизацией по ключу.

## Установка

```bash
npm install
```

## Запуск

```bash
# Обычный запуск
npm start

# Для разработки (с автоперезагрузкой)
npm run dev
```

## Настройка

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

Отредактируйте `.env` и установите `AUTH_USER` и `AUTH_PASS`:

```
AUTH_USER=ваш_логин
AUTH_PASS=ваш_пароль
PORT=3000
```

## Использование

Есть два способа указать целевой URL:

### 1. Через заголовок X-Target-URL

```bash
curl -H "X-Auth-Key: your-secret-key-here" \
     -H "X-Target-URL: https://api.example.com/data" \
     http://localhost:3000
```

### 2. Через путь в URL

```bash
curl -H "X-Auth-Key: your-secret-key-here" \
     http://localhost:3000/https://api.example.com/data
```

### Basic auth (логин:пароль)

```bash
curl -u "<USER>:<PASS>" \
     -H "X-Target-URL: https://jsonplaceholder.typicode.com/posts/1" \
     http://localhost:3000
```

## Примеры

### GET запрос

```bash
curl -H "X-Auth-Key: your-secret-key-here" \
     -H "X-Target-URL: https://jsonplaceholder.typicode.com/posts/1" \
     http://localhost:3000
```

### POST запрос

```bash
curl -X POST \
     -H "X-Auth-Key: your-secret-key-here" \
     -H "X-Target-URL: https://jsonplaceholder.typicode.com/posts" \
     -H "Content-Type: application/json" \
     -d '{"title":"foo","body":"bar","userId":1}' \
     http://localhost:3000
```

## Безопасность

- **Важно:** Храните ключ авторизации в переменных окружения
- Не коммитьте файл `.env` в репозиторий
- В продакшене используйте HTTPS
