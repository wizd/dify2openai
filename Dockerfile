# 使用官方 Node.js 基础镜像
FROM node:16-alpine

# 设置工作目录
WORKDIR /usr/src/app

# 复制 package.json 和 package-lock.json 到工作目录
COPY package*.json ./

# 安装项目依赖
RUN npm install

# 复制 app.js 到工作目录
COPY *.js ./

# 复制 keys_example.json 文件到容器中
RUN mkdir -p /usr/src/app/data

# 在容器启动时运行应用
CMD [ "npm", "start" ]

