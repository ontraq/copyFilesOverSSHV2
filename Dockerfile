FROM node:10
RUN npm install -g typescript
RUN npm i -g tfx-cli
RUN ssh-keygen -t rsa -N '' -f ~/.ssh/id_rsa <<< y