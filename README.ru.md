[English 🇺🇲](README.md) | [Русский 🇷🇺](README.ru.md)

<p align="center">
  <img src="icons/why-zenless-mod-manager.png" alt="WZMM Logo" width="256" height="256" />
</p>

<h1 align="center">WZMM</h1>

---

Лаунчер Zenless Zone Zero для Linux и Windows, способный скачивать моды с GameBanana и управлять локальными модами.

## Требования

* [XXMI](https://github.com/SpectrumQT/XXMI-Launcher)

## Начало работы

1. Скачайте последний релиз со [страницы Releases](https://github.com/whityx/WZMM/releases).
2. Запустите приложение.
3. В меню настроек укажите пути к XXMI.

## Сборка из исходного кода

WZMM — это приложение на базе Electron. Если вы предпочитаете собрать приложение вручную из исходного кода, выполните соответствующие шаги для вашей операционной системы.

### Windows

#### Предварительные требования

* **Git**
* **Node.js** (рекомендуется версия LTS) и **npm**

#### Инструкции по сборке

1. Склонируйте репозиторий и перейдите в папку проекта:
```bash
git clone https://github.com/whityx/WZMM.git
cd WZMM
```
2. Установите необходимые зависимости:
```bash
npm install
```
3. Соберите и упакуйте приложение для Windows (NSIS-установщик и portable-версия):
```bash
npm run dist:win
```

### Linux

#### Предварительные требования

* **Git**
* **Node.js** и **npm**
* **Базовые инструменты сборки** (компилятор C/C++, `make`, `python3` и т.д., которые требуются для компиляции нативных зависимостей Node.js/Electron).

> **Примечание об инструментах сборки:** 
> Точные названия пакетов для этих инструментов сборки различаются в зависимости от вашего дистрибутива Linux. Вам нужно будет поискать информацию о том, как установить базовые пакеты для разработки конкретно для вашего дистрибутива. 
> *(Например: ищите `build-essential`, если вы используете Debian/Ubuntu, `base-devel` для Arch Linux или `@development-tools` для Fedora).*

#### Инструкции по сборке

1. Склонируйте репозиторий и перейдите в папку проекта:
```bash
git clone https://github.com/whityx/WZMM.git
cd WZMM
```
2. Установите необходимые зависимости:
```bash
npm install
```
3. Соберите и упакуйте приложение для Linux (AppImage):
```bash
npm run dist:linux
```
