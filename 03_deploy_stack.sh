docker stack deploy --resolve-image=always --compose-file sweety-api-stack.yml api-stack

echo 'sleeping for 30s for testing'
sleep 30

./04_check_stack.sh
