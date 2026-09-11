declare module 'better-sqlite3' {
  namespace Database {
    type Database = any;
  }
  interface DatabaseConstructor {
    new (filename: string, options?: any): any;
    (filename: string, options?: any): any;
  }
  const Database: DatabaseConstructor;
  export = Database;
}

declare module 'qrcode' {
  const qrcode: any;
  export default qrcode;
}
