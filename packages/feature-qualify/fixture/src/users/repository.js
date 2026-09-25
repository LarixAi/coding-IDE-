function createUserRepository() {
  const records = [];
  return {
    add(user) {
      const record = { name: user.name, email: user.email };
      records.push(record);
      return record;
    },
    list() {
      return records.map((user) => ({ ...user }));
    },
  };
}

module.exports = { createUserRepository };
