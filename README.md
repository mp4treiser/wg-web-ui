## WG Easy Admin Panel

Админ-панель для управления несколькими экземплярами `wg-easy` из одного места.

### Стек

- **Backend**: FastAPI + Postgres + SQLAlchemy + httpx
- **Frontend**: React + TypeScript + Vite + TailwindCSS + Recharts
- **Infra**: Docker, docker-compose

### Быстрый старт

1. Установить Docker и docker-compose.
2. Скопировать файл `.env-example` в `.env` и при необходимости поправить значения
   (порты, креды Postgres, `VITE_API_URL`, `JWT_SECRET_KEY`).
3. В корне проекта выполнить:

```bash
docker-compose up --build
```

4. Откроется:
   - Backend API/Swagger: `http://localhost:8000/docs`
   - Frontend: `http://localhost:5173`

### Инициализация первого администратора

1. Перейти в Swagger: `http://localhost:8000/docs`.
2. Вызвать `POST /admin/register` с телом, например:

```json
{
  "email": "admin@example.com",
  "password": "VerySecurePassword"
}
```

3. После этого авторизация новых админов через `/admin/register` будет отключена.

### Вход в панель

1. На фронтенде (`http://localhost:5173`) ввести email/пароль, указанные при регистрации.
2. Backend выставит HttpOnly-cookie `access_token`, фронт начнёт ходить к API от твоего имени.

### Настройка серверов `wg-easy`

1. На вкладке **Servers** добавить сервер:
   - `name` — произвольное имя;
   - `base_url` — адрес панели wg-easy, например `http://213.175.65.49:5000`;
   - `username` / `password` — учётка администратора wg-easy.
2. Нажать кнопку **Проверить**, чтобы убедиться, что вход и запрос `/api/client` работают.

### Пользователи и peers

- Вкладка **Users**:
  - Создаёшь логического пользователя (например, имя человека).
  - Для выбранного пользователя добавляешь привязку к серверу:
    - выбираешь сервер;
    - указываешь дату экспирации (опционально).
  - Backend создаёт peer на соответствующем `wg-easy` (`/api/client`) и сохраняет его `clientId`.
  - Кнопка **QR код** открывает SVG с QR из `wg-easy` через прокси-эндпоинт backend.

### Dashboard

- Вкладка **Dashboard**:
  - Показывает количество серверов и peers.
  - Статус серверов (онлайн/оффлайн, количество активных клиентов).
  - График трафика (RX/TX в MB) по каждому серверу.


